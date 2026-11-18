import io

from pypdf import PdfWriter


def make_pdf(pages=3) -> bytes:
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=595, height=842)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def upload(client, headers, data=None, name="notes.pdf", **form):
    data = make_pdf() if data is None else data
    return client.post("/documents", headers=headers, files={"file": (name, data, "application/pdf")}, data=form)


def fund(client, admin, user_id, amount):
    r = client.post(
        f"/admin/wallets/{user_id}/adjust",
        json={"amount_paise": amount, "kind": "recharge", "reason": "Cash at counter"},
        headers=admin,
    )
    assert r.status_code == 201, r.text
