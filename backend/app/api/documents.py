from typing import List
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.config import MAX_COPIES
from app.core.db import get_db
from app.models.accounts import User
from app.schemas.documents import ColorMode, DocumentOut, DocumentSettings, PricingOut
from app.services import documents as svc
from app.services.pricing import current_rule

router = APIRouter(tags=["documents"])
owner_roles = require_roles("student", "staff")


@router.post("/documents", response_model=DocumentOut, status_code=201)
def upload_document(
    file: UploadFile = File(...),
    color_mode: ColorMode = Form("bw"),
    duplex: bool = Form(False),
    copies: int = Form(1, ge=1, le=MAX_COPIES),
    page_ranges: str = Form("all", max_length=200),
    user: User = Depends(owner_roles),
    db: Session = Depends(get_db),
):
    data = svc.read_limited(file.file)
    doc = svc.create_document(
        db,
        user,
        filename=file.filename,
        data=data,
        color_mode=color_mode,
        duplex=duplex,
        copies=copies,
        page_ranges=page_ranges,
    )
    return svc.to_out(doc, current_rule(db))


@router.get("/documents", response_model=List[DocumentOut])
def list_my_documents(user: User = Depends(owner_roles), db: Session = Depends(get_db)):
    rule = current_rule(db)
    return [svc.to_out(d, rule) for d in svc.list_documents(db, user)]


@router.get("/documents/{doc_id}", response_model=DocumentOut)
def get_document(doc_id: int, user: User = Depends(owner_roles), db: Session = Depends(get_db)):
    return svc.to_out(svc.get_owned(db, user, doc_id), current_rule(db))


@router.patch("/documents/{doc_id}/settings", response_model=DocumentOut)
def change_settings(
    doc_id: int, body: DocumentSettings, user: User = Depends(owner_roles), db: Session = Depends(get_db)
):
    doc = svc.get_owned(db, user, doc_id)
    doc = svc.update_settings(
        db,
        doc,
        color_mode=body.color_mode,
        duplex=body.duplex,
        copies=body.copies,
        page_ranges=body.page_ranges,
    )
    return svc.to_out(doc, current_rule(db))


@router.get("/documents/{doc_id}/file")
def download_document(doc_id: int, user: User = Depends(owner_roles), db: Session = Depends(get_db)):
    doc = svc.get_owned(db, user, doc_id)
    content = svc.read_plaintext(doc)
    return Response(
        content=content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"inline; filename=\"document.pdf\"; filename*=UTF-8''{quote(doc.original_name)}",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/documents/{doc_id}", status_code=204)
def delete_my_document(doc_id: int, user: User = Depends(owner_roles), db: Session = Depends(get_db)):
    svc.delete_document(db, svc.get_owned(db, user, doc_id))
    return Response(status_code=204)


@router.get("/pricing", response_model=PricingOut)
def get_pricing(_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return current_rule(db)
