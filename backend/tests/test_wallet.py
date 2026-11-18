import itertools
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.core.config import MAX_ADJUST_PAISE, MAX_PENDING_RECHARGES, RECHARGE_MAX_PAISE, RECHARGE_MIN_PAISE
from app.core.db import SessionLocal
from app.core.errors import ServiceError
from app.models.wallet import Wallet
from app.services import wallet as wsvc

_refs = itertools.count(1000)


def ref():
    return f"UTR{next(_refs)}"


def fund(client, admin, user_id, amount, key=None):
    body = {"amount_paise": amount, "kind": "recharge", "reason": "Cash at counter"}
    if key:
        body["idempotency_key"] = key
    r = client.post(f"/admin/wallets/{user_id}/adjust", json=body, headers=admin)
    assert r.status_code == 201, r.text
    return r.json()


def wallet(client, headers):
    return client.get("/wallet", headers=headers).json()


def hold(user_id, amount, key=None):
    with SessionLocal() as db:
        h = wsvc.place_hold(db, user_id=user_id, amount=amount, reference="job:test", idempotency_key=key)
        db.commit()
        return h.id


def hold_op(op, hold_id):
    with SessionLocal() as db:
        from app.models.wallet import WalletHold

        h = db.get(WalletHold, hold_id)
        try:
            getattr(wsvc, op)(db, h)
            db.commit()
        except ServiceError:
            db.rollback()
            raise


def test_new_wallet_is_empty(client, registered):
    _, h = registered()
    assert wallet(client, h) == {"balance_paise": 0, "held_paise": 0}
    assert client.get("/wallet/entries", headers=h).json() == []


def test_wallet_needs_student_or_staff(client, admin_headers):
    assert client.get("/wallet").status_code == 401
    assert client.get("/wallet", headers=admin_headers).status_code == 403


def test_recharge_request_approval_flow(client, registered, admin_headers):
    user, h = registered("Ravi Kumar")
    r = client.post("/wallet/recharge-requests", headers=h,
                    json={"amount_paise": 5000, "reference": "utr 5551 234", "note": "Paid at accounts"})
    assert r.status_code == 201, r.text
    req = r.json()
    assert req["status"] == "pending" and req["reference"] == "UTR5551234"
    assert wallet(client, h)["balance_paise"] == 0

    pending = client.get("/admin/recharge-requests", headers=admin_headers).json()
    mine = next(p for p in pending if p["id"] == req["id"])
    assert mine["college_id"] == user["college_id"] and mine["full_name"] == "Ravi Kumar"

    ok = client.post(f"/admin/recharge-requests/{req['id']}/approve", json={"note": "Receipt checked"}, headers=admin_headers)
    assert ok.status_code == 200 and ok.json()["status"] == "approved"
    assert wallet(client, h) == {"balance_paise": 5000, "held_paise": 0}

    entry = client.get("/wallet/entries", headers=h).json()[0]
    assert (entry["kind"], entry["amount_paise"], entry["balance_after_paise"]) == ("recharge", 5000, 5000)
    assert entry["recharge_request_id"] == req["id"]

    again = client.post(f"/admin/recharge-requests/{req['id']}/approve", json={}, headers=admin_headers)
    assert again.status_code == 409
    assert wallet(client, h)["balance_paise"] == 5000
    assert client.get("/wallet/recharge-requests", headers=h).json()[0]["status"] == "approved"


def test_reject_needs_reason_and_credits_nothing(client, registered, admin_headers):
    _, h = registered()
    req = client.post("/wallet/recharge-requests", headers=h, json={"amount_paise": 2000, "reference": ref()}).json()
    assert client.post(f"/admin/recharge-requests/{req['id']}/reject", json={"note": " "}, headers=admin_headers).status_code == 422
    r = client.post(f"/admin/recharge-requests/{req['id']}/reject", json={"note": "No such receipt"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert wallet(client, h)["balance_paise"] == 0
    assert client.post(f"/admin/recharge-requests/{req['id']}/approve", json={}, headers=admin_headers).status_code == 409
    assert client.post("/admin/recharge-requests/999999/approve", json={}, headers=admin_headers).status_code == 404


def test_recharge_request_validation(client, registered):
    _, h = registered()
    post = lambda **kw: client.post("/wallet/recharge-requests", headers=h, json={"amount_paise": 2000, "reference": ref(), **kw})
    assert post(amount_paise=RECHARGE_MIN_PAISE - 1).status_code == 422
    assert post(amount_paise=RECHARGE_MAX_PAISE + 1).status_code == 422
    assert post(reference="ab").status_code == 422
    assert post().status_code == 201


def test_duplicate_receipt_and_pending_limit_and_cancel(client, registered, admin_headers):
    _, h = registered()
    _, other = registered()
    shared = ref()
    first = client.post("/wallet/recharge-requests", headers=h, json={"amount_paise": 2000, "reference": shared})
    assert first.status_code == 201
    assert client.post("/wallet/recharge-requests", headers=other, json={"amount_paise": 2000, "reference": shared.lower()}).status_code == 409

    assert client.post(f"/wallet/recharge-requests/{first.json()['id']}/cancel", headers=other).status_code == 404
    cancelled = client.post(f"/wallet/recharge-requests/{first.json()['id']}/cancel", headers=h)
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert client.post(f"/admin/recharge-requests/{first.json()['id']}/approve", json={}, headers=admin_headers).status_code == 409
    assert client.post("/wallet/recharge-requests", headers=other, json={"amount_paise": 2000, "reference": shared}).status_code == 201

    for _ in range(MAX_PENDING_RECHARGES):
        assert client.post("/wallet/recharge-requests", headers=h, json={"amount_paise": 2000, "reference": ref()}).status_code == 201
    assert client.post("/wallet/recharge-requests", headers=h, json={"amount_paise": 2000, "reference": ref()}).status_code == 409


def test_admin_endpoints_forbidden_to_students(client, registered):
    user, h = registered()
    assert client.get("/admin/recharge-requests", headers=h).status_code == 403
    assert client.post(f"/admin/wallets/{user['id']}/adjust", headers=h,
                       json={"amount_paise": 100000, "reason": "give me money"}).status_code == 403
    assert client.get(f"/admin/wallets/{user['id']}", headers=h).status_code == 403
    assert client.get("/admin/wallet-reconcile", headers=h).status_code == 403


def test_admin_adjust_rules(client, registered, admin_headers):
    user, h = registered()
    uid = user["id"]
    adjust = lambda **kw: client.post(f"/admin/wallets/{uid}/adjust", headers=admin_headers,
                                      json={"amount_paise": 1000, "reason": "Correction", **kw})
    fund(client, admin_headers, uid, 1000)
    assert adjust(amount_paise=0).status_code == 422
    assert adjust(amount_paise=MAX_ADJUST_PAISE + 1).status_code == 422
    assert adjust(reason=" ").status_code == 422
    assert adjust(amount_paise=-5, kind="recharge").status_code == 422
    assert adjust(amount_paise=-1500).status_code == 402
    assert wallet(client, h)["balance_paise"] == 1000

    ok = adjust(amount_paise=-400)
    assert ok.status_code == 201 and ok.json()["balance_after_paise"] == 600
    assert client.post("/admin/wallets/999999/adjust", headers=admin_headers,
                       json={"amount_paise": 100, "reason": "ghost"}).status_code == 404


def test_idempotency_key_prevents_double_credit(client, registered, admin_headers):
    user, h = registered()
    uid = user["id"]
    first = fund(client, admin_headers, uid, 700, key="credit-key-0001")
    second = fund(client, admin_headers, uid, 700, key="credit-key-0001")
    assert first["id"] == second["id"]
    assert wallet(client, h)["balance_paise"] == 700
    clash = client.post(f"/admin/wallets/{uid}/adjust", headers=admin_headers,
                        json={"amount_paise": 900, "kind": "recharge", "reason": "other", "idempotency_key": "credit-key-0001"})
    assert clash.status_code == 409


def test_hold_capture_release_refund_lifecycle(client, registered, admin_headers):
    user, h = registered()
    uid = user["id"]
    fund(client, admin_headers, uid, 1000)

    h1 = hold(uid, 300)
    assert wallet(client, h) == {"balance_paise": 700, "held_paise": 300}
    hold_op("capture_hold", h1)
    assert wallet(client, h) == {"balance_paise": 700, "held_paise": 0}
    for op in ("capture_hold", "release_hold"):
        with pytest.raises(ServiceError):
            hold_op(op, h1)

    h2 = hold(uid, 200)
    hold_op("release_hold", h2)
    assert wallet(client, h) == {"balance_paise": 700, "held_paise": 0}
    with pytest.raises(ServiceError):
        hold_op("capture_hold", h2)

    h3 = hold(uid, 100)
    assert client.post(f"/admin/holds/{h3}/refund", json={"reason": "still active"}, headers=admin_headers).status_code == 409

    r = client.post(f"/admin/holds/{h1}/refund", json={"reason": "Printer jammed"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["kind"] == "refund"
    assert wallet(client, h) == {"balance_paise": 1000 - 100 - 0, "held_paise": 100}
    assert client.post(f"/admin/holds/{h1}/refund", json={"reason": "again"}, headers=admin_headers).status_code == 409
    assert client.post(f"/admin/holds/{h1}/refund", json={"reason": " "}, headers=admin_headers).status_code == 422
    assert client.post("/admin/holds/999999/refund", json={"reason": "ghost"}, headers=admin_headers).status_code == 404


def test_hold_requires_funds_and_is_idempotent(client, registered, admin_headers):
    user, h = registered()
    uid = user["id"]
    fund(client, admin_headers, uid, 500)
    with pytest.raises(ServiceError) as exc:
        hold(uid, 501)
    assert exc.value.status == 402
    assert wallet(client, h)["balance_paise"] == 500

    a = hold(uid, 200, key="job-1-attempt")
    b = hold(uid, 200, key="job-1-attempt")
    assert a == b
    assert wallet(client, h) == {"balance_paise": 300, "held_paise": 200}
    with pytest.raises(ServiceError):
        hold(uid, 250, key="job-1-attempt")
    with pytest.raises(ServiceError):
        hold(uid, 0)


def test_concurrent_holds_cannot_overdraw(client, registered, admin_headers):
    user, h = registered()
    uid = user["id"]
    fund(client, admin_headers, uid, 100)

    def attempt(i):
        with SessionLocal() as db:
            try:
                wsvc.place_hold(db, user_id=uid, amount=30, reference=f"race{i}", idempotency_key=f"race-key-{uid}-{i}")
                db.commit()
                return True
            except ServiceError:
                db.rollback()
                return False

    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(attempt, range(10)))
    assert sum(results) == 3
    assert wallet(client, h) == {"balance_paise": 10, "held_paise": 90}


def test_statement_is_consistent_and_reconciles(client, registered, admin_headers):
    user, h = registered()
    uid = user["id"]
    fund(client, admin_headers, uid, 1000)
    hold_op("capture_hold", hold(uid, 250))
    hold_op("release_hold", hold(uid, 100))
    entries = client.get("/wallet/entries", headers=h).json()
    assert entries[0]["balance_after_paise"] == wallet(client, h)["balance_paise"] == 750
    assert [e["kind"] for e in entries] == ["release", "hold", "capture", "hold", "recharge"]
    assert client.get("/wallet/entries", params={"limit": 2}, headers=h).json() == entries[:2]

    view = client.get(f"/admin/wallets/{uid}", headers=admin_headers).json()
    assert view["balance_paise"] == 750 and view["college_id"] == user["college_id"] and len(view["entries"]) == 5

    report = client.get("/admin/wallet-reconcile", headers=admin_headers).json()
    assert report["mismatch_count"] == 0 and report["wallets_checked"] >= 1


def test_reconcile_detects_tampering(client, admin_headers, registered):
    user, _ = registered()
    fund(client, admin_headers, user["id"], 500)
    with SessionLocal() as db:
        w = db.get(Wallet, user["id"])
        w.balance_paise = 99999
        db.commit()
    try:
        report = client.get("/admin/wallet-reconcile", headers=admin_headers).json()
        assert report["mismatch_count"] == 1
        assert report["mismatches"][0] == {"user_id": user["id"], "cached_paise": 99999, "ledger_paise": 500}
    finally:
        with SessionLocal() as db:
            db.get(Wallet, user["id"]).balance_paise = 500
            db.commit()
    assert client.get("/admin/wallet-reconcile", headers=admin_headers).json()["mismatch_count"] == 0


def test_database_refuses_negative_balance(client, registered):
    from sqlalchemy.exc import IntegrityError

    user, _ = registered()
    with SessionLocal() as db:
        wsvc._lock_wallet(db, user["id"])
        db.commit()
    with SessionLocal() as db:
        db.get(Wallet, user["id"]).balance_paise = -1
        with pytest.raises(IntegrityError):
            db.commit()


def test_money_actions_are_audited(client, registered, admin_headers):
    user, h = registered()
    uid = user["id"]
    req = client.post("/wallet/recharge-requests", headers=h, json={"amount_paise": 3000, "reference": ref()}).json()
    client.post(f"/admin/recharge-requests/{req['id']}/approve", json={}, headers=admin_headers)
    fund(client, admin_headers, uid, 100)
    hid = hold(uid, 50)
    hold_op("capture_hold", hid)
    client.post(f"/admin/holds/{hid}/refund", json={"reason": "Bad print"}, headers=admin_headers)

    actions = {a["action"] for a in client.get("/admin/audit", params={"limit": 50}, headers=admin_headers).json()}
    assert {"admin.recharge_approve", "admin.wallet_adjust", "admin.refund"} <= actions
    assert client.get("/admin/audit/verify", headers=admin_headers).json()["ok"] is True
