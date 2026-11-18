import itertools
import uuid
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.api.station import login_limiter as station_login_limiter
from app.core.config import MAX_ACTIVE_JOBS_PER_USER, STATION_IDLE_SECONDS, STATION_MAX_SESSION_SECONDS
from app.core.db import SessionLocal, utcnow
from app.models.accounts import User
from app.models.documents import Document
from app.models.jobs import PrintJob
from app.models.stations import StationSession
from app.services import documents as doc_svc
from tests.conftest import PASSWORD, PIN
from tests.helpers import fund, make_pdf, upload

_names = itertools.count(1)
_keys = itertools.count(1)


def key():
    return f"print-key-{uuid.uuid4().hex[:12]}"


@pytest.fixture(autouse=True)
def _reset_station_limiter():
    station_login_limiter.reset()


@pytest.fixture
def new_kiosk(client, admin_headers):
    def make():
        r = client.post("/admin/stations", json={"name": f"Kiosk {uuid.uuid4().hex[:8]}", "location": "Block A"}, headers=admin_headers)
        assert r.status_code == 201, r.text
        d = r.json()
        return SimpleNamespace(
            id=d["id"], key=d["station_key"], headers={"X-Station-Key": d["station_key"]},
            agent_headers={"X-Agent-Key": d["agent_key"]},
        )

    return make


def kiosk_login(client, kiosk, cid, pin=PIN):
    return client.post("/station/login", json={"college_id": cid, "pin": pin}, headers=kiosk.headers)


def session_headers(kiosk, login_response):
    return {**kiosk.headers, "X-Station-Session": login_response.json()["session_token"]}


@pytest.fixture
def ready(client, registered, admin_headers, new_kiosk):
    """A funded student with uploaded documents, logged in at a fresh kiosk."""

    def make(balance=100000, pages=(3,), **form):
        user, h = registered()
        if balance:
            fund(client, admin_headers, user["id"], balance)
        docs = [upload(client, h, make_pdf(p), **form).json() for p in pages]
        kiosk = new_kiosk()
        r = kiosk_login(client, kiosk, user["college_id"])
        assert r.status_code == 200, r.text
        return SimpleNamespace(user=user, h=h, docs=docs, kiosk=kiosk, sh=session_headers(kiosk, r))

    return make


def wallet(client, headers):
    return client.get("/wallet", headers=headers).json()


def print_(client, ctx, items, k=None):
    return client.post("/station/print", json={"items": items, "idempotency_key": k or key()}, headers=ctx.sh)


# ---------- admin side ----------

def test_station_admin_lifecycle(client, admin_headers, registered, new_kiosk):
    _, student = registered()
    assert client.post("/admin/stations", json={"name": "Nope"}, headers=student).status_code == 403

    k = new_kiosk()
    assert "." in k.key
    listing = client.get("/admin/stations", headers=admin_headers).json()
    mine = next(s for s in listing if s["id"] == k.id)
    assert mine["status"] == "active" and mine["in_use"] is False and "station_key" not in mine

    first_name = next(s for s in listing if s["id"] == k.id)["name"]
    assert client.post("/admin/stations", json={"name": first_name.upper()}, headers=admin_headers).status_code == 409

    assert client.post(f"/admin/stations/{k.id}/deactivate", json={"reason": " "}, headers=admin_headers).status_code == 422
    assert client.post(f"/admin/stations/{k.id}/deactivate", json={"reason": "Printer repair"}, headers=admin_headers).json()["status"] == "inactive"
    assert client.get("/station/me", headers=k.headers).status_code == 403
    assert client.post(f"/admin/stations/{k.id}/activate", json={"reason": "Repaired"}, headers=admin_headers).json()["status"] == "active"

    rotated = client.post(f"/admin/stations/{k.id}/rotate-key", json={"reason": "Routine rotation"}, headers=admin_headers).json()
    assert rotated["station_key"] != k.key
    assert client.get("/station/me", headers=k.headers).status_code == 401
    assert client.get("/station/me", headers={"X-Station-Key": rotated["station_key"]}).status_code == 401  # no session yet
    assert client.post("/station/login", json={"college_id": "X1234", "pin": "1357"}, headers={"X-Station-Key": rotated["station_key"]}).status_code == 401
    assert client.post("/admin/stations/99999/deactivate", json={"reason": "ghost"}, headers=admin_headers).status_code == 404

    actions = {a["action"] for a in client.get("/admin/audit", params={"limit": 100}, headers=admin_headers).json()}
    assert {"station.create", "station.deactivate", "station.activate", "station.rotate_key"} <= actions


def test_station_key_is_required_and_checked(client, new_kiosk):
    k = new_kiosk()
    login = lambda headers: client.post("/station/login", json={"college_id": "25881A05ZZ", "pin": "2580"}, headers=headers)
    assert login({}).status_code == 401
    assert login({"X-Station-Key": "garbage"}).status_code == 401
    assert login({"X-Station-Key": "99999.abcdef"}).status_code == 401
    assert login({"X-Station-Key": f"{k.id}.wrongsecret"}).status_code == 401
    assert login(k.headers).status_code == 401  # key fine, student unknown


# ---------- station login ----------

def test_login_success_and_generic_failures(client, registered, new_kiosk, admin_headers):
    user, _ = registered("Kiosk Kid")
    k = new_kiosk()
    r = kiosk_login(client, k, user["college_id"])
    assert r.status_code == 200
    body = r.json()
    assert body["full_name"] == "Kiosk Kid" and body["balance_paise"] == 0 and body["idle_timeout_seconds"] == STATION_IDLE_SECONDS
    sh = session_headers(k, r)
    assert client.get("/station/me", headers=sh).json()["college_id"] == user["college_id"]
    assert client.get("/station/me", headers=k.headers).status_code == 401

    wrong = kiosk_login(client, k, user["college_id"], "1357")
    unknown = kiosk_login(client, k, "25881A05ZY", "1357")
    assert wrong.status_code == unknown.status_code == 401 and wrong.json() == unknown.json()
    assert client.post("/station/login", json={"college_id": user["college_id"], "pin": "12ab"}, headers=k.headers).status_code == 422

    admin_id = client.get("/auth/me", headers=admin_headers).json()["college_id"]
    assert kiosk_login(client, k, admin_id).status_code == 401


def test_pin_lockout_is_separate_from_password(client, registered, new_kiosk, login, admin_headers):
    user, _ = registered()
    k = new_kiosk()
    for _ in range(5):
        assert kiosk_login(client, k, user["college_id"], "1357").status_code == 401
    assert kiosk_login(client, k, user["college_id"]).status_code == 429
    assert login(user["college_id"]).status_code == 200
    actions = {a["action"] for a in client.get("/admin/audit", params={"limit": 20}, headers=admin_headers).json()}
    assert "station.pin_lockout" in actions


def test_blocked_user_cannot_use_station(client, ready, admin_headers):
    c = ready()
    assert client.get("/station/me", headers=c.sh).status_code == 200
    client.post(f"/admin/users/{c.user['id']}/block", json={"reason": "Misuse"}, headers=admin_headers)
    assert client.get("/station/me", headers=c.sh).status_code == 401
    assert kiosk_login(client, c.kiosk, c.user["college_id"]).status_code == 403


def test_session_binding_expiry_logout_and_replacement(client, ready, new_kiosk):
    c = ready()
    other = new_kiosk()
    assert client.get("/station/me", headers={**other.headers, "X-Station-Session": c.sh["X-Station-Session"]}).status_code == 401

    again = kiosk_login(client, c.kiosk, c.user["college_id"])
    assert again.status_code == 200
    assert client.get("/station/me", headers=c.sh).status_code == 401  # replaced by the new login
    sh2 = session_headers(c.kiosk, again)
    assert client.get("/station/me", headers=sh2).status_code == 200

    with SessionLocal() as db:
        s = db.scalar(select(StationSession).where(StationSession.user_id == c.user["id"], StationSession.ended_at.is_(None)))
        s.last_activity_at = utcnow() - timedelta(seconds=STATION_IDLE_SECONDS + 5)
        db.commit()
    assert client.get("/station/me", headers=sh2).status_code == 401

    third = kiosk_login(client, c.kiosk, c.user["college_id"])
    sh3 = session_headers(c.kiosk, third)
    with SessionLocal() as db:
        s = db.scalar(select(StationSession).where(StationSession.user_id == c.user["id"], StationSession.ended_at.is_(None)))
        s.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    assert client.get("/station/me", headers=sh3).status_code == 401

    fourth = kiosk_login(client, c.kiosk, c.user["college_id"])
    sh4 = session_headers(c.kiosk, fourth)
    assert client.post("/station/logout", headers=sh4).status_code == 204
    assert client.get("/station/me", headers=sh4).status_code == 401
    assert STATION_MAX_SESSION_SECONDS > STATION_IDLE_SECONDS


def test_deactivating_station_ends_sessions(client, ready, admin_headers):
    c = ready()
    client.post(f"/admin/stations/{c.kiosk.id}/deactivate", json={"reason": "Emergency stop"}, headers=admin_headers)
    assert client.get("/station/me", headers=c.sh).status_code == 403
    client.post(f"/admin/stations/{c.kiosk.id}/activate", json={"reason": "Back online"}, headers=admin_headers)
    assert client.get("/station/me", headers=c.sh).status_code == 401  # old session is gone for good


def test_station_login_is_rate_limited_per_station(client, new_kiosk):
    k = new_kiosk()
    codes = [kiosk_login(client, k, "25881A05ZX", "1357").status_code for _ in range(22)]
    assert codes[:20] == [401] * 20 and codes[20:] == [429, 429]
    assert kiosk_login(client, new_kiosk(), "25881A05ZX", "1357").status_code == 401  # other stations unaffected


# ---------- documents, quote, print ----------

def test_station_lists_only_own_documents_and_quotes(client, ready):
    a = ready(pages=(3, 5))
    b = ready(pages=(2,))
    docs = client.get("/station/documents", headers=a.sh).json()
    assert {d["id"] for d in docs} == {d["id"] for d in a.docs}

    d1, d2 = a.docs[0]["id"], a.docs[1]["id"]
    q = client.post("/station/quote", json={"items": [{"document_id": d1}, {"document_id": d2, "copies": 3}]}, headers=a.sh).json()
    assert [l["price_paise"] for l in q["lines"]] == [3 * 200, 5 * 200 * 3]
    assert q["total_paise"] == 600 + 3000 and q["total_pages"] == 3 + 15
    assert q["sufficient"] is True and q["shortfall_paise"] == 0

    assert client.post("/station/quote", json={"items": [{"document_id": b.docs[0]["id"]}]}, headers=a.sh).status_code == 404
    assert client.post("/station/quote", json={"items": []}, headers=a.sh).status_code == 422
    assert client.post("/station/quote", json={"items": [{"document_id": d1}, {"document_id": d1}]}, headers=a.sh).status_code == 422
    assert client.post("/station/quote", json={"items": [{"document_id": d1, "copies": 0}]}, headers=a.sh).status_code == 422
    assert client.post("/station/quote", json={"items": [{"document_id": d1}]}).status_code == 401


def test_quote_flags_shortfall(client, ready):
    c = ready(balance=500)
    q = client.post("/station/quote", json={"items": [{"document_id": c.docs[0]["id"]}]}, headers=c.sh).json()
    assert q["total_paise"] == 600 and q["sufficient"] is False and q["shortfall_paise"] == 100


def test_print_creates_job_and_holds_money(client, ready):
    c = ready(balance=10000, pages=(3, 4), color_mode="color", duplex="true")
    items = [{"document_id": c.docs[0]["id"], "copies": 2}, {"document_id": c.docs[1]["id"]}]
    r = print_(client, c, items)
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["status"] == "queued" and job["total_paise"] == (3 * 2 + 4) * 1000
    assert [(i["copies"], i["color_mode"], i["duplex"], i["price_paise"], i["status"]) for i in job["items"]] == [
        (2, "color", True, 6000, "queued"), (1, "color", True, 4000, "queued")]
    assert wallet(client, c.h) == {"balance_paise": 0, "held_paise": 10000}

    entry = client.get("/wallet/entries", headers=c.h).json()[0]
    assert entry["kind"] == "hold" and entry["amount_paise"] == -10000 and entry["reference"] == f"job:{job['id']}"
    assert client.get("/jobs", headers=c.h).json()[0]["id"] == job["id"]
    assert client.get(f"/jobs/{job['id']}", headers=c.h).json()["total_paise"] == 10000
    assert [j["id"] for j in client.get("/station/jobs", headers=c.sh).json()] == [job["id"]]


def test_print_is_idempotent(client, ready):
    c = ready(balance=5000)
    items = [{"document_id": c.docs[0]["id"]}]
    k = key()
    first = print_(client, c, items, k).json()
    second = print_(client, c, items, k).json()
    assert first["id"] == second["id"]
    assert wallet(client, c.h) == {"balance_paise": 4400, "held_paise": 600}
    assert len(client.get("/jobs", headers=c.h).json()) == 1


def test_print_with_insufficient_funds_changes_nothing(client, ready):
    c = ready(balance=500)
    r = print_(client, c, [{"document_id": c.docs[0]["id"]}])
    assert r.status_code == 402 and "6.00" in r.json()["detail"] and "5.00" in r.json()["detail"]
    assert wallet(client, c.h) == {"balance_paise": 500, "held_paise": 0}
    assert client.get("/jobs", headers=c.h).json() == []


def test_print_limits(client, ready):
    big = ready(pages=(200,))
    r = print_(client, big, [{"document_id": big.docs[0]["id"], "copies": 6}])
    assert r.status_code == 422 and wallet(client, big.h)["held_paise"] == 0

    c = ready(balance=100000)
    for _ in range(MAX_ACTIVE_JOBS_PER_USER):
        assert print_(client, c, [{"document_id": c.docs[0]["id"]}]).status_code == 201
    assert print_(client, c, [{"document_id": c.docs[0]["id"]}]).status_code == 409


def test_expired_document_cannot_be_printed(client, ready):
    c = ready()
    with SessionLocal() as db:
        db.get(Document, c.docs[0]["id"]).expires_at = utcnow() - timedelta(minutes=1)
        db.commit()
    assert print_(client, c, [{"document_id": c.docs[0]["id"]}]).status_code == 410


def test_cancel_releases_the_hold(client, ready, registered):
    c = ready(balance=2000)
    job = print_(client, c, [{"document_id": c.docs[0]["id"]}]).json()
    assert wallet(client, c.h) == {"balance_paise": 1400, "held_paise": 600}

    _, stranger = registered()
    assert client.get(f"/jobs/{job['id']}", headers=stranger).status_code == 404

    r = client.post(f"/station/jobs/{job['id']}/cancel", headers=c.sh)
    assert r.status_code == 200 and r.json()["status"] == "cancelled" and r.json()["items"][0]["status"] == "cancelled"
    assert wallet(client, c.h) == {"balance_paise": 2000, "held_paise": 0}
    assert client.post(f"/station/jobs/{job['id']}/cancel", headers=c.sh).status_code == 409

    again = print_(client, c, [{"document_id": c.docs[0]["id"]}]).json()
    with SessionLocal() as db:
        db.get(PrintJob, again["id"]).status = "printing"
        db.commit()
    assert client.post(f"/station/jobs/{again['id']}/cancel", headers=c.sh).status_code == 409
    assert client.post("/station/jobs/999999/cancel", headers=c.sh).status_code == 404


def test_phones_cannot_print(client, ready):
    c = ready(balance=5000)
    body = {"items": [{"document_id": c.docs[0]["id"]}], "idempotency_key": key()}
    assert client.post("/station/print", json=body, headers=c.h).status_code == 401
    assert client.post("/station/print", json=body, headers=c.kiosk.headers).status_code == 401
    assert client.post("/jobs", json=body, headers=c.h).status_code == 405
    assert client.get("/jobs", headers=c.h).json() == []


def test_documents_are_protected_while_an_order_is_active(client, ready):
    c = ready()
    doc_id = c.docs[0]["id"]
    job = print_(client, c, [{"document_id": doc_id}]).json()
    assert client.delete(f"/documents/{doc_id}", headers=c.h).status_code == 409

    with SessionLocal() as db:
        db.get(Document, doc_id).expires_at = utcnow() - timedelta(minutes=1)
        db.commit()
        doc_svc.purge_expired(db)
        assert db.get(Document, doc_id).deleted_at is None

    client.post(f"/station/jobs/{job['id']}/cancel", headers=c.sh)
    with SessionLocal() as db:
        doc_svc.purge_expired(db)
        assert db.get(Document, doc_id).deleted_at is not None


def test_station_activity_is_visible_to_admin(client, ready, admin_headers):
    c = ready()
    client.get("/station/me", headers=c.sh)
    mine = next(s for s in client.get("/admin/stations", headers=admin_headers).json() if s["id"] == c.kiosk.id)
    assert mine["last_seen_at"] is not None and mine["in_use"] is True
    assert client.get("/admin/audit/verify", headers=admin_headers).json()["ok"] is True
