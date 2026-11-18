import io

from pypdf import PdfWriter

from app.core.config import MAX_DOCS_PER_USER, UPLOAD_DIR
from app.core.db import SessionLocal, utcnow
from app.models.documents import Document
from app.services import documents as svc
from datetime import timedelta


def make_pdf(pages=3, password=None, js=False, attachment=False) -> bytes:
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=595, height=842)
    if js:
        w.add_js("app.alert('hi');")
    if attachment:
        w.add_attachment("note.txt", b"hello")
    if password:
        w.encrypt(password)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def upload(client, headers, data=None, name="notes.pdf", **form):
    data = make_pdf() if data is None else data
    return client.post("/documents", headers=headers, files={"file": (name, data, "application/pdf")}, data=form)


def rates(client, headers):
    r = client.get("/pricing", headers=headers).json()
    return r["bw_paise_per_page"], r["color_paise_per_page"]


def test_upload_defaults_and_estimate(client, registered):
    _, h = registered()
    bw, _ = rates(client, h)
    r = upload(client, h)
    assert r.status_code == 201, r.text
    d = r.json()
    assert (d["page_count"], d["selected_pages"], d["page_ranges"]) == (3, 3, "all")
    assert (d["color_mode"], d["duplex"], d["copies"]) == ("bw", False, 1)
    assert d["rate_paise_per_page"] == bw and d["estimated_price_paise"] == 3 * bw


def test_upload_with_settings(client, registered):
    _, h = registered()
    _, color = rates(client, h)
    r = upload(client, h, make_pdf(5), color_mode="color", duplex="true", copies="2", page_ranges="1-2, 4,2")
    assert r.status_code == 201, r.text
    d = r.json()
    assert (d["page_ranges"], d["selected_pages"], d["copies"], d["duplex"], d["color_mode"]) == ("1-2,4", 3, 2, True, "color")
    assert d["estimated_price_paise"] == 3 * color * 2


def test_selecting_every_page_is_normalised_to_all(client, registered):
    _, h = registered()
    assert upload(client, h, make_pdf(5), page_ranges="1-5").json()["page_ranges"] == "all"


def test_bad_settings_rejected_and_nothing_stored(client, registered):
    user, h = registered()
    for bad in ("0", "5-2", "9", "a-b", "1,,2", "1-"):
        assert upload(client, h, make_pdf(5), page_ranges=bad).status_code == 422, bad
    assert upload(client, h, color_mode="rainbow").status_code == 422
    assert upload(client, h, copies="0").status_code == 422
    assert upload(client, h, copies="101").status_code == 422
    assert client.get("/documents", headers=h).json() == []
    assert not list((UPLOAD_DIR / str(user["id"])).glob("*")) if (UPLOAD_DIR / str(user["id"])).exists() else True


def test_unsafe_or_unusable_pdfs_rejected(client, registered):
    _, h = registered()
    cases = {
        "not a pdf": b"hello this is not a pdf",
        "empty": b"",
        "corrupt": b"%PDF-1.4\ngarbage",
        "encrypted": make_pdf(2, password="secret"),
        "javascript": make_pdf(2, js=True),
        "attachment": make_pdf(2, attachment=True),
        "too many pages": make_pdf(201),
    }
    for label, data in cases.items():
        r = upload(client, h, data)
        assert r.status_code == 400, (label, r.status_code, r.text)
    big = b"%PDF-1.4\n" + b"0" * (21 * 1024 * 1024)
    assert upload(client, h, big).status_code == 413
    assert client.get("/documents", headers=h).json() == []


def test_file_is_encrypted_on_disk_and_round_trips(client, registered):
    user, h = registered()
    original = make_pdf(2)
    doc = upload(client, h, original, name="../../my résumé.pdf").json()
    assert doc["original_name"] == "my résumé.pdf"

    stored = list((UPLOAD_DIR / str(user["id"])).glob("*.enc"))
    assert len(stored) == 1
    raw = stored[0].read_bytes()
    assert not raw.startswith(b"%PDF-") and original not in raw

    r = client.get(f"/documents/{doc['id']}/file", headers=h)
    assert r.status_code == 200 and r.content == original
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].startswith("inline")


def test_documents_are_private(client, registered):
    _, mine = registered()
    _, theirs = registered()
    doc = upload(client, mine).json()
    i = doc["id"]
    assert client.get("/documents", headers=theirs).json() == []
    assert client.get(f"/documents/{i}", headers=theirs).status_code == 404
    assert client.get(f"/documents/{i}/file", headers=theirs).status_code == 404
    assert client.patch(f"/documents/{i}/settings", json={"copies": 5}, headers=theirs).status_code == 404
    assert client.delete(f"/documents/{i}", headers=theirs).status_code == 404
    assert client.get(f"/documents/{i}", headers=mine).status_code == 200


def test_auth_and_roles_required(client, registered, admin_headers):
    assert client.get("/documents").status_code == 401
    assert client.get("/pricing").status_code == 401
    assert upload(client, admin_headers).status_code == 403
    assert client.get("/pricing", headers=admin_headers).status_code == 200


def test_staff_can_upload(client, new_student, register, login):
    cid, code = new_student("Staff Member", role="staff")
    assert register(cid, code).status_code == 201
    h = {"Authorization": f"Bearer {login(cid).json()['access_token']}"}
    assert upload(client, h).status_code == 201


def test_change_settings_recalculates_price(client, registered):
    _, h = registered()
    bw, color = rates(client, h)
    doc = upload(client, h, make_pdf(5)).json()
    r = client.patch(f"/documents/{doc['id']}/settings",
                     json={"color_mode": "color", "copies": 3, "page_ranges": "2-3"}, headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert (d["selected_pages"], d["page_ranges"]) == (2, "2-3")
    assert d["estimated_price_paise"] == 2 * color * 3
    assert client.get(f"/documents/{doc['id']}", headers=h).json() == d

    assert client.patch(f"/documents/{doc['id']}/settings", json={}, headers=h).status_code == 422
    assert client.patch(f"/documents/{doc['id']}/settings", json={"copies": 0}, headers=h).status_code == 422
    assert client.patch(f"/documents/{doc['id']}/settings", json={"page_ranges": "9"}, headers=h).status_code == 422
    assert client.get(f"/documents/{doc['id']}", headers=h).json() == d


def test_delete_removes_file_and_hides_document(client, registered):
    user, h = registered()
    doc = upload(client, h).json()
    assert client.delete(f"/documents/{doc['id']}", headers=h).status_code == 204
    assert client.get(f"/documents/{doc['id']}", headers=h).status_code == 404
    assert client.get("/documents", headers=h).json() == []
    assert list((UPLOAD_DIR / str(user["id"])).glob("*.enc")) == []


def test_document_limit_per_user(client, registered):
    _, h = registered()
    tiny = make_pdf(1)
    for _ in range(MAX_DOCS_PER_USER):
        assert upload(client, h, tiny).status_code == 201
    assert upload(client, h, tiny).status_code == 409
    first = client.get("/documents", headers=h).json()[0]["id"]
    assert client.delete(f"/documents/{first}", headers=h).status_code == 204
    assert upload(client, h, tiny).status_code == 201


def test_expired_documents_are_purged(client, registered):
    user, h = registered()
    doc = upload(client, h).json()
    keep = upload(client, h).json()
    with SessionLocal() as db:
        row = db.get(Document, doc["id"])
        row.expires_at = utcnow() - timedelta(minutes=1)
        db.commit()
        assert svc.purge_expired(db) >= 1
    assert client.get(f"/documents/{doc['id']}", headers=h).status_code == 404
    assert client.get(f"/documents/{keep['id']}", headers=h).status_code == 200
    assert len(list((UPLOAD_DIR / str(user["id"])).glob("*.enc"))) == 1


def test_page_range_parser():
    assert svc.parse_page_ranges("all", 4) == ("all", 4)
    assert svc.parse_page_ranges("", 4) == ("all", 4)
    assert svc.parse_page_ranges("1-3,3,5", 9) == ("1-3,5", 4)
    assert svc.parse_page_ranges("7, 2", 9) == ("2,7", 2)
    assert svc.parse_page_ranges("1-4", 4) == ("all", 4)


def test_admin_pricing_flow(client, registered, admin_headers):
    _, student = registered()
    old_bw, old_color = rates(client, student)
    doc = upload(client, student).json()

    body = {"bw_paise_per_page": 300, "color_paise_per_page": 1200, "reason": "Toner cost increase"}
    assert client.post("/admin/pricing", json=body, headers=student).status_code == 403
    assert client.post("/admin/pricing", json={**body, "reason": " "}, headers=admin_headers).status_code == 422
    assert client.post("/admin/pricing", json={**body, "bw_paise_per_page": -1}, headers=admin_headers).status_code == 422

    try:
        r = client.post("/admin/pricing", json=body, headers=admin_headers)
        assert r.status_code == 201, r.text
        assert rates(client, student) == (300, 1200)
        assert client.get(f"/documents/{doc['id']}", headers=student).json()["estimated_price_paise"] == 3 * 300

        history = client.get("/admin/pricing/history", headers=admin_headers).json()
        assert history[0]["reason"] == "Toner cost increase" and len(history) >= 2
        audit = client.get("/admin/audit", headers=admin_headers).json()
        assert any(a["action"] == "admin.pricing_change" for a in audit)
        assert client.get("/admin/audit/verify", headers=admin_headers).json()["ok"] is True
    finally:
        client.post("/admin/pricing",
                    json={"bw_paise_per_page": old_bw, "color_paise_per_page": old_color, "reason": "Restore test prices"},
                    headers=admin_headers)
    assert rates(client, student) == (old_bw, old_color)
