from datetime import timedelta

import pytest

from app.core.config import JOB_LEASE_SECONDS, PRINTER_STALE_SECONDS, QUEUE_TIMEOUT_SECONDS
from app.core.db import SessionLocal, utcnow
from app.models.jobs import PrintJob
from app.models.stations import Station
from app.services import agent as agent_svc
from tests.test_stations import key, new_kiosk, print_, ready, wallet  # noqa: F401  (shared fixtures)


def claim(client, k):
    r = client.post("/agent/claim", headers=k.agent_headers)
    assert r.status_code in (200, 204), r.text
    return r.json() if r.status_code == 200 else None


def report(client, k, job_id, item_id, status, reason=None):
    return client.post(f"/agent/jobs/{job_id}/items/{item_id}/result", json={"status": status, "reason": reason}, headers=k.agent_headers)


def set_printer(client, k, status, message=None):
    r = client.post("/agent/printer-status", json={"status": status, "message": message}, headers=k.agent_headers)
    assert r.status_code == 204, r.text


def order(client, c, doc_indexes=(0,)):
    r = print_(client, c, [{"document_id": c.docs[i]["id"]} for i in doc_indexes])
    assert r.status_code == 201, r.text
    return r.json()


def sweep():
    with SessionLocal() as db:
        return agent_svc.sweep(db)


def entries(client, c):
    return [e["kind"] for e in client.get("/wallet/entries", headers=c.h).json()]


def test_keys_are_separate(client, ready):
    c = ready()
    assert client.post("/agent/claim", headers=c.kiosk.headers).status_code == 401
    assert client.post("/agent/claim", headers={"X-Agent-Key": c.kiosk.key}).status_code == 401
    assert client.post("/agent/claim").status_code == 401
    assert client.post("/agent/claim", headers={"X-Agent-Key": f"{c.kiosk.id}.nope"}).status_code == 401
    assert client.post("/station/login", json={"college_id": c.user["college_id"], "pin": "2580"}, headers=c.kiosk.agent_headers).status_code == 401
    assert client.post("/agent/claim", headers=c.h).status_code == 401


def test_full_success_charges_the_hold(client, ready):
    c = ready(balance=10000, pages=(3, 4))
    job = order(client, c, (0, 1))
    assert wallet(client, c.h) == {"balance_paise": 10000 - 1400, "held_paise": 1400}

    got = claim(client, c.kiosk)
    assert got["id"] == job["id"] and [i["status"] for i in got["items"]] == ["queued", "queued"]
    assert client.get("/jobs", headers=c.h).json()[0]["status"] == "printing"
    assert claim(client, c.kiosk) is None  # one order at a time

    for item in got["items"]:
        f = client.get(f"/agent/jobs/{got['id']}/items/{item['id']}/file", headers=c.kiosk.agent_headers)
        assert f.status_code == 200 and f.headers["content-type"] == "application/pdf"
        assert f.content.startswith(b"%PDF-")
        assert report(client, c.kiosk, got["id"], item["id"], "done").status_code == 200

    final = client.get(f"/jobs/{job['id']}", headers=c.h).json()
    assert final["status"] == "completed" and final["failure_reason"] is None and final["finished_at"]
    assert wallet(client, c.h) == {"balance_paise": 8600, "held_paise": 0}
    assert entries(client, c)[:2] == ["capture", "hold"]
    assert client.get("/admin/wallet-reconcile", headers=_admin(client)).json()["mismatch_count"] == 0


def _admin(client):
    from app.services import accounts as svc
    from tests.conftest import PASSWORD, _suffixes

    cid = f"AGA{next(_suffixes)}"
    with SessionLocal() as db:
        svc.create_admin(db, cid, "Agent Test Admin", PASSWORD)
    token = client.post("/auth/login", data={"username": cid, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_file_bytes_match_the_upload(client, ready):
    c = ready()
    order(client, c)
    got = claim(client, c.kiosk)
    original = client.get(f"/documents/{c.docs[0]['id']}/file", headers=c.h).content
    f = client.get(f"/agent/jobs/{got['id']}/items/{got['items'][0]['id']}/file", headers=c.kiosk.agent_headers)
    assert f.content == original and original.startswith(b"%PDF-")


def test_partial_failure_charges_only_what_printed(client, ready, admin_headers):
    c = ready(balance=10000, pages=(3, 4))
    job = order(client, c, (0, 1))
    got = claim(client, c.kiosk)
    assert report(client, c.kiosk, got["id"], got["items"][0]["id"], "done").status_code == 200
    assert client.get(f"/jobs/{job['id']}", headers=c.h).json()["status"] == "printing"
    assert report(client, c.kiosk, got["id"], got["items"][1]["id"], "failed", "Paper jam").status_code == 200

    final = client.get(f"/jobs/{job['id']}", headers=c.h).json()
    assert final["status"] == "partial" and "charged only" in final["failure_reason"]
    assert [i["status"] for i in final["items"]] == ["done", "failed"]
    assert wallet(client, c.h) == {"balance_paise": 10000 - 600, "held_paise": 0}
    assert entries(client, c)[:3] == ["release", "capture", "hold"]

    hold_id = client.get("/wallet/entries", headers=c.h).json()[0]["hold_id"]
    r = client.post(f"/admin/holds/{hold_id}/refund", json={"reason": "Reprint not possible"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["amount_paise"] == 600
    assert wallet(client, c.h)["balance_paise"] == 10000


def test_total_failure_returns_everything(client, ready):
    c = ready(balance=5000)
    job = order(client, c)
    got = claim(client, c.kiosk)
    report(client, c.kiosk, got["id"], got["items"][0]["id"], "failed", "Printer offline")
    final = client.get(f"/jobs/{job['id']}", headers=c.h).json()
    assert final["status"] == "failed" and final["failure_reason"] == "Printer offline"
    assert wallet(client, c.h) == {"balance_paise": 5000, "held_paise": 0}
    assert claim(client, c.kiosk) is None


def test_results_are_idempotent_and_guarded(client, ready):
    c = ready(pages=(3, 2))
    order(client, c, (0, 1))
    got = claim(client, c.kiosk)
    jid, first, second = got["id"], got["items"][0]["id"], got["items"][1]["id"]
    assert report(client, c.kiosk, jid, first, "done").status_code == 200
    assert report(client, c.kiosk, jid, first, "done").status_code == 200
    assert report(client, c.kiosk, jid, first, "failed").status_code == 409
    assert client.get(f"/agent/jobs/{jid}/items/{first}/file", headers=c.kiosk.agent_headers).status_code == 409
    assert report(client, c.kiosk, jid, 999999, "done").status_code == 404
    assert report(client, c.kiosk, jid, second, "done").status_code == 200
    assert report(client, c.kiosk, jid, second, "done").status_code == 200


def test_other_stations_cannot_touch_an_order(client, ready, new_kiosk):
    c = ready()
    order(client, c)
    got = claim(client, c.kiosk)
    other = new_kiosk()
    item = got["items"][0]["id"]
    assert client.get(f"/agent/jobs/{got['id']}/items/{item}/file", headers=other.agent_headers).status_code == 404
    assert report(client, other, got["id"], item, "done").status_code == 404
    assert claim(client, other) is None


def test_files_need_a_claimed_order(client, ready):
    c = ready()
    job = order(client, c)
    with SessionLocal() as db:
        from app.models.jobs import PrintJobItem
        item_id = db.query(PrintJobItem.id).filter(PrintJobItem.job_id == job["id"]).scalar()
    assert client.get(f"/agent/jobs/{job['id']}/items/{item_id}/file", headers=c.kiosk.agent_headers).status_code == 409


def test_orders_are_printed_oldest_first(client, ready):
    c = ready(balance=10000)
    first = order(client, c)
    second = order(client, c)
    got = claim(client, c.kiosk)
    assert got["id"] == first["id"]
    assert claim(client, c.kiosk) is None
    report(client, c.kiosk, got["id"], got["items"][0]["id"], "done")
    assert claim(client, c.kiosk)["id"] == second["id"]


def test_printer_problems_stop_orders_before_money_is_taken(client, ready, admin_headers):
    c = ready()
    assert client.get("/station/status", headers=c.kiosk.headers).json()["printer_available"] is True  # unknown = allowed

    set_printer(client, c.kiosk, "no_paper", "Tray empty")
    status = client.get("/station/status", headers=c.kiosk.headers).json()
    assert status["printer_available"] is False and status["message"] == "Tray empty"
    r = print_(client, c, [{"document_id": c.docs[0]["id"]}])
    assert r.status_code == 503 and wallet(client, c.h) == {"balance_paise": 100000, "held_paise": 0}
    listing = next(s for s in client.get("/admin/stations", headers=admin_headers).json() if s["id"] == c.kiosk.id)
    assert listing["printer_status"] == "no_paper" and listing["printer_ok"] is False and listing["agent_configured"] is True

    set_printer(client, c.kiosk, "online")
    job = order(client, c)
    set_printer(client, c.kiosk, "offline")
    assert claim(client, c.kiosk) is None
    set_printer(client, c.kiosk, "online")
    assert claim(client, c.kiosk)["id"] == job["id"]


def test_silent_agent_is_treated_as_offline(client, ready):
    c = ready()
    set_printer(client, c.kiosk, "online")
    assert print_(client, c, [{"document_id": c.docs[0]["id"]}]).status_code == 201
    with SessionLocal() as db:
        db.get(Station, c.kiosk.id).printer_status_at = utcnow() - timedelta(seconds=PRINTER_STALE_SECONDS + 5)
        db.commit()
    assert print_(client, c, [{"document_id": c.docs[0]["id"]}]).status_code == 503
    assert client.get("/station/status", headers=c.kiosk.headers).json()["printer_available"] is False


def test_crashed_agent_order_is_failed_and_refunded(client, ready, admin_headers):
    c = ready(balance=5000)
    job = order(client, c)
    claim(client, c.kiosk)
    assert sweep()["stuck"] == 0
    with SessionLocal() as db:
        db.get(PrintJob, job["id"]).lease_expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    assert sweep()["stuck"] >= 1
    final = client.get(f"/jobs/{job['id']}", headers=c.h).json()
    assert final["status"] == "failed" and final["items"][0]["status"] == "failed"
    assert wallet(client, c.h) == {"balance_paise": 5000, "held_paise": 0}
    actions = {a["action"] for a in client.get("/admin/audit", params={"limit": 50}, headers=admin_headers).json()}
    assert "job.stuck" in actions


def test_abandoned_queued_order_is_cancelled_and_refunded(client, ready, admin_headers):
    c = ready(balance=5000)
    job = order(client, c)
    with SessionLocal() as db:
        db.get(PrintJob, job["id"]).created_at = utcnow() - timedelta(seconds=QUEUE_TIMEOUT_SECONDS + 5)
        db.commit()
    assert sweep()["timed_out"] >= 1
    final = client.get(f"/jobs/{job['id']}", headers=c.h).json()
    assert final["status"] == "cancelled" and "returned" in final["failure_reason"]
    assert wallet(client, c.h) == {"balance_paise": 5000, "held_paise": 0}
    assert client.get("/admin/audit/verify", headers=admin_headers).json()["ok"] is True


def test_agent_key_rotation(client, ready, admin_headers):
    c = ready()
    r = client.post(f"/admin/stations/{c.kiosk.id}/rotate-agent-key", json={"reason": "Staff change"}, headers=admin_headers)
    assert r.status_code == 200
    assert client.post("/agent/claim", headers=c.kiosk.agent_headers).status_code == 401
    assert client.post("/agent/claim", headers={"X-Agent-Key": r.json()["agent_key"]}).status_code in (200, 204)
    assert client.get("/station/me", headers=c.sh).status_code == 200  # kiosk session unaffected
    assert JOB_LEASE_SECONDS > 0
