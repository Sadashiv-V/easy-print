import os
import string
import sys
import tempfile
from itertools import product
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["EASYPRINT_DATA_DIR"] = tempfile.mkdtemp(prefix="easyprint_test_")
os.environ.pop("EASYPRINT_DATABASE_URL", None)

import pytest
from fastapi.testclient import TestClient

from app.api.auth import login_limiter, register_limiter
from app.core.db import SessionLocal
from app.main import app
from app.services import accounts as svc

PASSWORD = "Str0ng-pass!"
PIN = "2580"
_suffixes = ("".join(p) for p in product(string.ascii_uppercase, repeat=2))


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_limiters():
    login_limiter.reset()
    register_limiter.reset()


@pytest.fixture
def new_student():
    """Adds one student to the roster; returns (college_id, activation_code)."""

    def make(name="Test Student", role="student"):
        cid = f"25881A05{next(_suffixes)}" if role == "student" else f"STF{next(_suffixes)}01"
        with SessionLocal() as db:
            codes, skipped = svc.import_roster(db, [{"college_id": cid, "full_name": name, "role": role}])
        assert not skipped, skipped
        return cid, codes[0][2]

    return make


@pytest.fixture
def register(client):
    def do(cid, code, password=PASSWORD, pin=PIN):
        return client.post(
            "/auth/register",
            json={"college_id": cid, "activation_code": code, "password": password, "station_pin": pin},
        )

    return do


@pytest.fixture
def login(client):
    def do(cid, password=PASSWORD):
        return client.post("/auth/login", data={"username": cid, "password": password})

    return do


@pytest.fixture
def registered(new_student, register, login):
    """Registers a student and returns (user_json, auth_headers)."""

    def make(name="Test Student"):
        cid, code = new_student(name)
        user = register(cid, code).json()
        token = login(cid).json()["access_token"]
        return user, {"Authorization": f"Bearer {token}"}

    return make


@pytest.fixture
def admin_headers(login):
    cid = f"ADM{next(_suffixes)}"
    with SessionLocal() as db:
        svc.create_admin(db, cid, "Test Admin", PASSWORD)
    token = login(cid).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
