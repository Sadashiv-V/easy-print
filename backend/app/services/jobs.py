from typing import List, NamedTuple, Optional

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import config
from app.core.db import utcnow
from app.core.errors import ServiceError
from app.models.accounts import User
from app.models.documents import Document
from app.models.jobs import ACTIVE_JOB_STATUSES, JOB_CANCELLED, JOB_QUEUED, PrintJob, PrintJobItem
from app.models.pricing import PricingRule
from app.models.stations import Station, StationSession
from app.models.wallet import WalletHold
from app.schemas.stations import JobItemOut, JobOut, PrintItemIn, QuoteLineOut, QuoteOut
from app.services.pricing import current_rule, rate_for
from app.services.stations import printer_available
from app.services.wallet import get_balance, place_hold, release_hold


class _Line(NamedTuple):
    doc: Document
    copies: int
    pages: int
    rate: int
    price: int


def _rupees(paise: int) -> str:
    return f"\u20b9{paise / 100:.2f}"


def _prepare(db: Session, user: User, items: List[PrintItemIn]):
    if not items:
        raise ServiceError(422, "Select at least one document")
    if len(items) > config.MAX_DOCS_PER_USER:
        raise ServiceError(422, f"You can print at most {config.MAX_DOCS_PER_USER} documents at once")
    ids = [i.document_id for i in items]
    if len(set(ids)) != len(ids):
        raise ServiceError(422, "Each document can be selected only once")

    rule = current_rule(db)
    now = utcnow()
    lines: List[_Line] = []
    for item in items:
        doc = db.get(Document, item.document_id)
        if not doc or doc.user_id != user.id or doc.deleted_at is not None:
            raise ServiceError(404, f"Document {item.document_id} not found")
        if doc.expires_at <= now:
            raise ServiceError(410, f"'{doc.original_name}' has expired. Upload it again.")
        copies = item.copies or doc.copies
        rate = rate_for(rule, doc.color_mode)
        pages = doc.selected_pages * copies
        lines.append(_Line(doc, copies, pages, rate, pages * rate))

    if sum(l.pages for l in lines) > config.MAX_PAGES_PER_JOB:
        raise ServiceError(422, f"One print order can have at most {config.MAX_PAGES_PER_JOB} pages in total")
    return lines, rule, sum(l.price for l in lines)


def quote(db: Session, user: User, items: List[PrintItemIn]) -> QuoteOut:
    lines, _rule, total = _prepare(db, user, items)
    balance = get_balance(db, user.id)
    return QuoteOut(
        lines=[
            QuoteLineOut(
                document_id=l.doc.id, original_name=l.doc.original_name, copies=l.copies,
                selected_pages=l.doc.selected_pages, color_mode=l.doc.color_mode, duplex=l.doc.duplex,
                rate_paise_per_page=l.rate, price_paise=l.price,
            )
            for l in lines
        ],
        total_pages=sum(l.pages for l in lines),
        total_paise=total,
        balance_paise=balance,
        sufficient=balance >= total,
        shortfall_paise=max(0, total - balance),
    )


def job_out(db: Session, job: PrintJob) -> JobOut:
    items = db.scalars(select(PrintJobItem).where(PrintJobItem.job_id == job.id).order_by(PrintJobItem.id)).all()
    return JobOut(
        id=job.id, status=job.status, station_id=job.station_id, total_paise=job.total_paise,
        failure_reason=job.failure_reason, created_at=job.created_at, finished_at=job.finished_at,
        items=[JobItemOut.model_validate(i, from_attributes=True) for i in items],
    )


def create_job(
    db: Session, *, user: User, station: Station, session: StationSession,
    items: List[PrintItemIn], idempotency_key: str,
) -> JobOut:
    prior = db.scalar(select(PrintJob).where(PrintJob.user_id == user.id, PrintJob.idempotency_key == idempotency_key))
    if prior:
        return job_out(db, prior)

    if not printer_available(station):
        raise ServiceError(503, "This station's printer is not available right now. Please try another station.")
    lines, rule, total = _prepare(db, user, items)

    active = db.scalar(
        select(func.count(PrintJob.id)).where(PrintJob.user_id == user.id, PrintJob.status.in_(ACTIVE_JOB_STATUSES))
    )
    if active >= config.MAX_ACTIVE_JOBS_PER_USER:
        raise ServiceError(409, "You already have print orders waiting. Collect or cancel them first.")
    balance = get_balance(db, user.id)
    if balance < total:
        raise ServiceError(402, f"Insufficient balance: this costs {_rupees(total)} but your wallet has {_rupees(balance)}")

    job = PrintJob(
        user_id=user.id, station_id=station.id, session_id=session.id, status=JOB_QUEUED,
        total_paise=total, pricing_rule_id=rule.id, idempotency_key=idempotency_key,
    )
    db.add(job)
    try:
        db.flush()
    except IntegrityError:
        # A simultaneous duplicate click won the race; hand back its order instead of failing.
        db.rollback()
        prior = db.scalar(select(PrintJob).where(PrintJob.user_id == user.id, PrintJob.idempotency_key == idempotency_key))
        if prior:
            return job_out(db, prior)
        raise
    if total > 0:
        hold = place_hold(db, user_id=user.id, amount=total, reference=f"job:{job.id}", idempotency_key=f"job-{job.id}")
        job.hold_id = hold.id
    for l in lines:
        db.add(
            PrintJobItem(
                job_id=job.id, document_id=l.doc.id, document_name=l.doc.original_name, copies=l.copies,
                color_mode=l.doc.color_mode, duplex=l.doc.duplex, page_ranges=l.doc.page_ranges,
                selected_pages=l.doc.selected_pages, rate_paise_per_page=l.rate, price_paise=l.price,
            )
        )
    db.commit()
    return job_out(db, job)


def _owned_job(db: Session, user: User, job_id: int) -> PrintJob:
    job = db.get(PrintJob, job_id)
    if not job or job.user_id != user.id:
        raise ServiceError(404, "Print order not found")
    return job


def cancel_job(db: Session, user: User, job_id: int) -> JobOut:
    job = _owned_job(db, user, job_id)
    now = utcnow()
    result = db.execute(
        update(PrintJob)
        .where(PrintJob.id == job.id, PrintJob.status == JOB_QUEUED)
        .values(status=JOB_CANCELLED, finished_at=now, updated_at=now)
    )
    if result.rowcount != 1:
        raise ServiceError(409, "This print order can no longer be cancelled")
    db.execute(update(PrintJobItem).where(PrintJobItem.job_id == job.id).values(status="cancelled"))
    if job.hold_id:
        release_hold(db, db.get(WalletHold, job.hold_id))
    db.commit()
    db.refresh(job)
    return job_out(db, job)


def list_jobs(db: Session, user: User, *, station_id: Optional[int] = None, limit: int = 20) -> List[JobOut]:
    query = select(PrintJob).where(PrintJob.user_id == user.id).order_by(PrintJob.id.desc()).limit(limit)
    if station_id is not None:
        query = query.where(PrintJob.station_id == station_id)
    return [job_out(db, j) for j in db.scalars(query)]


def get_job(db: Session, user: User, job_id: int) -> JobOut:
    return job_out(db, _owned_job(db, user, job_id))
