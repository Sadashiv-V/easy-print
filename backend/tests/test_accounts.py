from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core.config import MAX_ACTIVATION_ATTEMPTS, MAX_FAILED_LOGINS
from app.core.db import SessionLocal
from app.core.ratelimit import RateLimiter
from app.models.audit import AuditLog
from app.services import accounts as svc
from app.services.audit import verify_chain
from tests.conftest import PASSWORD, PIN


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/health").headers["x-content-type-options"] == "nosniff"


def test_register_takes_identity_from_roster(client, new_student):
    cid, code = new_student("Asha Rao")
    r = client.post(
        "/auth/register",
        json={"college_id": cid.lower(), "activation_code": code.lower(), "password": PASSWORD,
              "station_pin": PIN, "role": "admin", "full_name": "Hacker"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["college_id"], body["full_name"], body["role"]) == (cid, "Asha Rao", "student")


def test_register_rejects_bad_code_and_unknown_id_with_same_message(client, new_student, register):
    cid, _ = new_student()
    wrong = register(cid, "AAAA-BBBB")
    unknown = register("25881A05ZZ", "AAAA-BBBB")
    assert wrong.status_code == unknown.status_code == 400
    assert wrong.json() == unknown.json()


def test_activation_code_lockout(client, new_student, register):
    cid, code = new_student()
    for _ in range(MAX_ACTIVATION_ATTEMPTS):
        assert register(cid, "AAAA-BBBB").status_code == 400
    assert register(cid, code).status_code == 429


def test_cannot_register_twice(client, new_student, register):
    cid, code = new_student()
    assert register(cid, code).status_code == 201
    assert register(cid, code).status_code == 400


def test_weak_password_and_pin_rejected(client, new_student, register):
    cid, code = new_student()
    assert register(cid, code, password="short").status_code == 422
    assert register(cid, code, password=f"x{cid}x!").status_code == 422
    assert register(cid, code, pin="1234").status_code == 422
    assert register(cid, code, pin="0000").status_code == 422
    assert register(cid, code, pin="12").status_code == 422
    assert register(cid, code).status_code == 201


def test_login_me_and_bad_tokens(client, registered):
    user, headers = registered()
    assert client.get("/auth/me", headers=headers).json()["college_id"] == user["college_id"]
    assert client.get("/auth/me").status_code == 401
    assert client.get("/auth/me", headers={"Authorization": "Bearer abc.def.ghi"}).status_code == 401


def test_login_is_case_insensitive_and_generic_on_failure(client, registered, login):
    user, _ = registered()
    assert login(user["college_id"].lower()).status_code == 200
    wrong_pw = login(user["college_id"], "wrong-password-1")
    unknown = login("NOSUCHID1", "wrong-password-1")
    assert wrong_pw.status_code == unknown.status_code == 401
    assert wrong_pw.json() == unknown.json()


def test_login_lockout(client, registered, login):
    user, _ = registered()
    for _ in range(MAX_FAILED_LOGINS):
        assert login(user["college_id"], "wrong-password-1").status_code == 401
    assert login(user["college_id"]).status_code == 429


def test_admin_routes_need_admin(client, registered, admin_headers):
    _, student = registered()
    assert client.get("/admin/users").status_code == 401
    assert client.get("/admin/users", headers=student).status_code == 403
    assert client.get("/admin/users", headers=admin_headers).status_code == 200


def test_block_kills_sessions_and_unblock_restores(client, registered, admin_headers, login):
    user, headers = registered()
    r = client.post(f"/admin/users/{user['id']}/block", json={"reason": "Misuse of printer"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "blocked"
    assert client.get("/auth/me", headers=headers).status_code == 401
    assert login(user["college_id"]).status_code == 403
    assert client.post(f"/admin/users/{user['id']}/block", json={"reason": "again"}, headers=admin_headers).status_code == 409

    r = client.post(f"/admin/users/{user['id']}/unblock", json={"reason": "Resolved"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "active"
    assert login(user["college_id"]).status_code == 200


def test_block_needs_reason_and_not_self(client, registered, admin_headers):
    user, _ = registered()
    assert client.post(f"/admin/users/{user['id']}/block", json={"reason": " "}, headers=admin_headers).status_code == 422
    me = client.get("/auth/me", headers=admin_headers).json()
    assert client.post(f"/admin/users/{me['id']}/block", json={"reason": "oops"}, headers=admin_headers).status_code == 400
    assert client.post("/admin/users/999999/block", json={"reason": "ghost"}, headers=admin_headers).status_code == 404


def test_admin_user_search(client, registered, admin_headers):
    user, _ = registered("Searchable Person")
    by_id = client.get("/admin/users", params={"search": user["college_id"][:8]}, headers=admin_headers).json()
    by_name = client.get("/admin/users", params={"search": "searchable"}, headers=admin_headers).json()
    assert any(u["id"] == user["id"] for u in by_id)
    assert any(u["id"] == user["id"] for u in by_name)
    assert client.get("/admin/users", params={"search": "%"}, headers=admin_headers).json() == []


def test_change_password_invalidates_old_sessions(client, registered, login):
    user, old_headers = registered()
    r = client.post("/auth/change-password",
                    json={"current_password": PASSWORD, "new_password": "An0ther-pass!"}, headers=old_headers)
    assert r.status_code == 200
    new_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/auth/me", headers=old_headers).status_code == 401
    assert client.get("/auth/me", headers=new_headers).status_code == 200
    assert login(user["college_id"]).status_code == 401
    assert login(user["college_id"], "An0ther-pass!").status_code == 200


def test_change_password_and_pin_need_current_password(client, registered):
    _, headers = registered()
    bad = client.post("/auth/change-password",
                      json={"current_password": "nope-nope-1", "new_password": "An0ther-pass!"}, headers=headers)
    assert bad.status_code == 401
    assert client.post("/auth/change-station-pin",
                       json={"password": "nope-nope-1", "new_pin": "7391"}, headers=headers).status_code == 401
    assert client.post("/auth/change-station-pin",
                       json={"password": PASSWORD, "new_pin": "1234"}, headers=headers).status_code == 422
    assert client.post("/auth/change-station-pin",
                       json={"password": PASSWORD, "new_pin": "7391"}, headers=headers).status_code == 204


def test_roster_import_validation(client):
    rows = [
        {"college_id": "25881A09Q1", "full_name": "Good Student", "role": "student"},
        {"college_id": "25991A09Q2", "full_name": "Wrong College", "role": "student"},
        {"college_id": "BAD", "full_name": "Bad Format", "role": "student"},
        {"college_id": "25881A09Q1", "full_name": "Duplicate In File", "role": "student"},
        {"college_id": "25881A09Q3", "full_name": "", "role": "student"},
        {"college_id": "25881A09Q4", "full_name": "Odd Role", "role": "janitor"},
        {"college_id": "STAFFQ01", "full_name": "Good Staff", "role": "staff"},
    ]
    with SessionLocal() as db:
        codes, skipped = svc.import_roster(db, rows)
    assert [c[0] for c in codes] == ["25881A09Q1", "STAFFQ01"]
    assert len(skipped) == 5
    with SessionLocal() as db:
        _, again = svc.import_roster(db, rows[:1])
    assert again[0][2] == "already in roster"


def test_student_id_parsing():
    assert svc.parse_student_id("25881A05AY") == {"admission_year": 2025, "admission_type": "1A", "branch_code": "05"}
    assert svc.parse_student_id("25991A05AY") is None
    assert svc.parse_student_id("2588A05AY") is None


def test_audit_chain_detects_tampering(client, registered, admin_headers):
    registered()
    assert client.get("/admin/audit/verify", headers=admin_headers).json()["ok"] is True
    assert len(client.get("/admin/audit", headers=admin_headers).json()) > 0

    with SessionLocal() as db:
        row = db.query(AuditLog).order_by(AuditLog.id).first()
        original = row.action
        row.action = "something.else"
        db.commit()
        assert verify_chain(db)[0] is False
        row.action = original
        db.commit()
        assert verify_chain(db)[0] is True


def test_rate_limiter_blocks_after_limit():
    app = FastAPI()
    limiter = RateLimiter(3, 60)

    @app.get("/ping", dependencies=[Depends(limiter)])
    def ping():
        return {"ok": True}

    c = TestClient(app)
    assert [c.get("/ping").status_code for _ in range(4)] == [200, 200, 200, 429]
