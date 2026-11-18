import hashlib
import io
import re
import uuid
from datetime import timedelta
from typing import BinaryIO, List, Optional, Tuple

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError
from cryptography.fernet import InvalidToken
from pypdf import PdfReader
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import config
from app.core.crypto import decrypt_bytes, encrypt_bytes
from app.core.db import utcnow
from app.core.errors import ServiceError
from app.models.accounts import User
from app.models.documents import Document
from app.models.jobs import ACTIVE_JOB_STATUSES, PrintJob, PrintJobItem
from app.models.pricing import PricingRule
from app.schemas.documents import DocumentOut
from app.services.audit import log_event
from app.services.pricing import estimate_paise, rate_for

_BAD_ACTIONS = {"/JavaScript", "/Launch", "/ImportData", "/SubmitForm", "/Rendition", "/GoToE"}
_BAD_RAW = (b"/JavaScript", b"/Launch", b"/EmbeddedFile", b"/RichMedia")
_PART_RE = re.compile(r"(\d{1,4})(?:-(\d{1,4}))?")

_s3 = None


def _client():
    global _s3
    if _s3 is None:
        _s3 = boto3.client(
            "s3",
            endpoint_url=config.R2_ENDPOINT,
            aws_access_key_id=config.R2_ACCESS_KEY_ID,
            aws_secret_access_key=config.R2_SECRET_ACCESS_KEY,
            config=BotoConfig(signature_version="s3v4"),
            region_name="auto",
        )
    return _s3


def _object_key(doc: Document) -> str:
    return f"{doc.user_id}/{doc.stored_name}"


def _put_object(key: str, data: bytes) -> None:
    _client().put_object(Bucket=config.R2_BUCKET, Key=key, Body=data)


def _get_object(key: str) -> bytes:
    try:
        return _client().get_object(Bucket=config.R2_BUCKET, Key=key)["Body"].read()
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
            raise ServiceError(404, "File is missing from storage")
        raise


def _delete_object(key: str) -> None:
    try:
        _client().delete_object(Bucket=config.R2_BUCKET, Key=key)
    except ClientError:
        pass  # best effort — object may already be gone


def _resolve(obj):
    return obj.get_object() if hasattr(obj, "get_object") else obj


def _has_active_content(reader: PdfReader) -> bool:
    root = _resolve(reader.trailer["/Root"])
    if "/AA" in root:
        return True
    action = _resolve(root.get("/OpenAction"))
    if isinstance(action, dict) and _resolve(action.get("/S")) in _BAD_ACTIONS:
        return True
    names = _resolve(root.get("/Names"))
    if isinstance(names, dict) and ("/JavaScript" in names or "/EmbeddedFiles" in names):
        return True
    for page in reader.pages:
        if "/AA" in page:
            return True
        for annot in _resolve(page.get("/Annots")) or []:
            annot = _resolve(annot)
            if "/AA" in annot:
                return True
            act = _resolve(annot.get("/A"))
            if isinstance(act, dict) and _resolve(act.get("/S")) in _BAD_ACTIONS:
                return True
    return False


def validate_pdf(data: bytes) -> int:
    """Returns the page count, or raises ServiceError if the file is unsafe or unusable."""
    if not data.startswith(b"%PDF-"):
        raise ServiceError(400, "File is not a valid PDF")
    if any(token in data for token in _BAD_RAW):
        raise ServiceError(400, "This PDF contains scripts or embedded files. Print it to a new PDF first.")
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            raise ServiceError(400, "Password-protected PDFs are not supported")
        pages = len(reader.pages)
        active = _has_active_content(reader)
    except ServiceError:
        raise
    except Exception:
        raise ServiceError(400, "Could not read this PDF. It may be corrupted.")
    if active:
        raise ServiceError(400, "This PDF contains scripts or embedded files. Print it to a new PDF first.")
    if pages < 1:
        raise ServiceError(400, "This PDF has no pages")
    if pages > config.MAX_PAGES_PER_DOC:
        raise ServiceError(400, f"PDF has too many pages (max {config.MAX_PAGES_PER_DOC})")
    return pages


def read_limited(fileobj: BinaryIO) -> bytes:
    buf = bytearray()
    while chunk := fileobj.read(1024 * 1024):
        buf.extend(chunk)
        if len(buf) > config.MAX_UPLOAD_BYTES:
            raise ServiceError(413, f"File too large (max {config.MAX_UPLOAD_BYTES // (1024 * 1024)} MB)")
    if not buf:
        raise ServiceError(400, "Empty file")
    return bytes(buf)


def _compress(pages: List[int]) -> str:
    parts, start, prev = [], pages[0], pages[0]
    for n in pages[1:] + [None]:
        if n is not None and n == prev + 1:
            prev = n
            continue
        parts.append(str(start) if start == prev else f"{start}-{prev}")
        if n is not None:
            start = prev = n
    return ",".join(parts)


def parse_page_ranges(spec: Optional[str], page_count: int) -> Tuple[str, int]:
    """'1-3, 5' -> ('1-3,5', 4). Empty or 'all' selects every page."""
    spec = (spec or "all").strip().lower()
    if spec in ("", "all"):
        return "all", page_count
    if len(spec) > 200:
        raise ServiceError(422, "Page selection is too long")
    selected = set()
    for part in spec.replace(" ", "").split(","):
        m = _PART_RE.fullmatch(part)
        if not m:
            raise ServiceError(422, f"Invalid page selection near '{part}'. Use something like 1-3,5")
        start = int(m.group(1))
        end = int(m.group(2) or start)
        if start < 1 or end < start or end > page_count:
            raise ServiceError(422, f"Pages must be between 1 and {page_count}")
        selected.update(range(start, end + 1))
    if len(selected) == page_count:
        return "all", page_count
    return _compress(sorted(selected)), len(selected)


def _clean_name(raw: Optional[str]) -> str:
    name = (raw or "document.pdf").replace("\\", "/").split("/")[-1]
    name = "".join(ch for ch in name if ch.isprintable()).strip()
    return (name or "document.pdf")[:150]


def create_document(
    db: Session,
    user: User,
    *,
    filename: Optional[str],
    data: bytes,
    color_mode: str,
    duplex: bool,
    copies: int,
    page_ranges: Optional[str],
) -> Document:
    pages = validate_pdf(data)
    normalized, selected = parse_page_ranges(page_ranges, pages)

    count, used = db.execute(
        select(func.count(Document.id), func.coalesce(func.sum(Document.size_bytes), 0)).where(
            Document.user_id == user.id, Document.deleted_at.is_(None)
        )
    ).one()
    if count >= config.MAX_DOCS_PER_USER:
        raise ServiceError(409, f"Document limit reached ({config.MAX_DOCS_PER_USER}). Delete some first.")
    if used + len(data) > config.MAX_TOTAL_BYTES_PER_USER:
        raise ServiceError(409, "Storage quota exceeded. Delete some documents first.")

    now = utcnow()
    doc = Document(
        user_id=user.id,
        original_name=_clean_name(filename),
        stored_name=f"{uuid.uuid4().hex}.enc",
        size_bytes=len(data),
        page_count=pages,
        sha256=hashlib.sha256(data).hexdigest(),
        color_mode=color_mode,
        duplex=duplex,
        copies=copies,
        page_ranges=normalized,
        selected_pages=selected,
        created_at=now,
        expires_at=now + timedelta(days=config.DOCUMENT_RETENTION_DAYS),
    )
    key = _object_key(doc)
    _put_object(key, encrypt_bytes(data))
    db.add(doc)
    try:
        db.commit()
    except Exception:
        db.rollback()
        _delete_object(key)
        raise
    return doc


def get_owned(db: Session, user: User, doc_id: int) -> Document:
    doc = db.get(Document, doc_id)
    if not doc or doc.user_id != user.id or doc.deleted_at is not None:
        raise ServiceError(404, "Document not found")
    return doc


def list_documents(db: Session, user: User) -> List[Document]:
    return list(
        db.scalars(
            select(Document)
            .where(Document.user_id == user.id, Document.deleted_at.is_(None))
            .order_by(Document.created_at.desc(), Document.id.desc())
        )
    )


def update_settings(
    db: Session,
    doc: Document,
    *,
    color_mode: Optional[str],
    duplex: Optional[bool],
    copies: Optional[int],
    page_ranges: Optional[str],
) -> Document:
    if page_ranges is not None:
        doc.page_ranges, doc.selected_pages = parse_page_ranges(page_ranges, doc.page_count)
    if color_mode is not None:
        doc.color_mode = color_mode
    if duplex is not None:
        doc.duplex = duplex
    if copies is not None:
        doc.copies = copies
    db.commit()
    return doc


def read_plaintext(doc: Document) -> bytes:
    token = _get_object(_object_key(doc))
    try:
        return decrypt_bytes(token)
    except InvalidToken:
        raise ServiceError(500, "This file cannot be read. Contact the administrator.")


def _in_active_job(db: Session, doc_id: int) -> bool:
    return db.scalar(
        select(PrintJobItem.id)
        .join(PrintJob, PrintJob.id == PrintJobItem.job_id)
        .where(PrintJobItem.document_id == doc_id, PrintJob.status.in_(ACTIVE_JOB_STATUSES))
        .limit(1)
    ) is not None


def delete_document(db: Session, doc: Document) -> None:
    if _in_active_job(db, doc.id):
        raise ServiceError(409, "This document has a print order in progress. Cancel it or wait until it finishes.")
    _delete_object(_object_key(doc))
    doc.deleted_at = utcnow()
    db.commit()


def purge_expired(db: Session) -> int:
    now = utcnow()
    docs = db.scalars(select(Document).where(Document.deleted_at.is_(None), Document.expires_at <= now)).all()
    purged = 0
    for doc in docs:
        if _in_active_job(db, doc.id):
            continue
        _delete_object(_object_key(doc))
        doc.deleted_at = now
        purged += 1
    if purged:
        log_event(db, action="documents.purge", detail={"count": purged})
    db.commit()
    return purged


def to_out(doc: Document, rule: PricingRule) -> DocumentOut:
    return DocumentOut(
        id=doc.id,
        original_name=doc.original_name,
        size_bytes=doc.size_bytes,
        page_count=doc.page_count,
        color_mode=doc.color_mode,
        duplex=doc.duplex,
        copies=doc.copies,
        page_ranges=doc.page_ranges,
        selected_pages=doc.selected_pages,
        rate_paise_per_page=rate_for(rule, doc.color_mode),
        estimated_price_paise=estimate_paise(doc, rule),
        created_at=doc.created_at,
        expires_at=doc.expires_at,
    )