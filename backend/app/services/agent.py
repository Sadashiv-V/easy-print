from datetime import timedelta
from typing import Optional, Tuple

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core import config
from app.core.db import utcnow
from app.core.errors import ServiceError
from app.models.documents import Document
from app.models.jobs import (
    JOB_CANCELLED,
    JOB_COMPLETED,
    JOB_FAILED,
    JOB_PARTIAL,
    JOB_PRINTING,
    JOB_QUEUED,
    PrintJob,
    PrintJobItem,
)
from app.models.stations import Station
from app.models.wallet import WalletHold
from app.services.audit import log_event
from app.services.documents import read_plaintext
from app.services.stations import printer_available
from app.services.wallet import release_hold, settle_hold


def _lease() :
    return utcnow() + timedelta(seconds=config.JOB_LEASE_SECONDS)


def _items(db: Session, job_id: int):
    return list(db.scalars(select(PrintJobItem).where(PrintJobItem.job_id == job_id).order_by(PrintJobItem.id)))


def finalize_job(db: Session, job: PrintJob) -> None:
    """Called once every file has a result: charges what printed and returns the rest."""
    items = _items(db, job.id)
    done = [i for i in items if i.status == "done"]
    charge = sum(i.price_paise for i in done)
    if len(done) == len(items):
        status, reason = JOB_COMPLETED, None
    elif not done:
        status = JOB_FAILED
        reason = next((i.failure_reason for i in items if i.failure_reason), "Could not print")
    else:
        status, reason = JOB_PARTIAL, "Some files could not be printed. You were charged only for what printed."

    now = utcnow()
    result = db.execute(
        update(PrintJob)
        .where(PrintJob.id == job.id, PrintJob.status == JOB_PRINTING)
        .values(status=status, failure_reason=reason, finished_at=now, updated_at=now, lease_expires_at=None)
    )
    if result.rowcount != 1:
        return
    if job.hold_id:
        settle_hold(db, db.get(WalletHold, job.hold_id), charge=charge)
    db.refresh(job)


def claim_next(db: Session, station: Station) -> Optional[PrintJob]:
    if not printer_available(station):
        return None
    sweep(db)
    busy = db.scalar(select(PrintJob.id).where(PrintJob.station_id == station.id, PrintJob.status == JOB_PRINTING).limit(1))
    if busy:
        return None
    job = db.scalar(
        select(PrintJob).where(PrintJob.station_id == station.id, PrintJob.status == JOB_QUEUED).order_by(PrintJob.id).limit(1)
    )
    if not job:
        return None
    now = utcnow()
    result = db.execute(
        update(PrintJob)
        .where(PrintJob.id == job.id, PrintJob.status == JOB_QUEUED)
        .values(status=JOB_PRINTING, started_at=now, lease_expires_at=_lease(), updated_at=now)
    )
    if result.rowcount != 1:
        return None
    db.commit()
    db.refresh(job)
    return job


def job_items(db: Session, job: PrintJob):
    return _items(db, job.id)


def _owned(db: Session, station: Station, job_id: int, item_id: int) -> Tuple[PrintJob, PrintJobItem]:
    job = db.get(PrintJob, job_id)
    item = db.get(PrintJobItem, item_id)
    if not job or job.station_id != station.id or not item or item.job_id != job.id:
        raise ServiceError(404, "Print item not found")
    return job, item


def item_file(db: Session, station: Station, job_id: int, item_id: int) -> bytes:
    job, item = _owned(db, station, job_id, item_id)
    if job.status != JOB_PRINTING or item.status != "queued":
        raise ServiceError(409, "This file is not waiting to be printed")
    doc = db.get(Document, item.document_id)
    if not doc or doc.deleted_at is not None:
        raise ServiceError(410, "The document is no longer available")
    data = read_plaintext(doc)
    job.lease_expires_at = _lease()
    db.commit()
    return data


def report_item(db: Session, station: Station, job_id: int, item_id: int, status: str, reason: Optional[str]) -> PrintJob:
    job, item = _owned(db, station, job_id, item_id)
    if item.status in ("done", "failed"):
        if item.status == status:
            return job
        raise ServiceError(409, "A different result was already reported for this file")
    if job.status != JOB_PRINTING:
        raise ServiceError(409, "This print order is not being printed")

    item.status = status
    item.failure_reason = (reason or "Printing failed")[:200] if status == "failed" else None
    job.lease_expires_at = _lease()
    db.flush()
    if not any(i.status == "queued" for i in _items(db, job.id)):
        finalize_job(db, job)
    db.commit()
    db.refresh(job)
    return job


def set_printer_status(db: Session, station: Station, status: str, message: Optional[str]) -> None:
    now = utcnow()
    station.printer_status = status
    station.printer_message = message
    station.printer_status_at = now
    station.last_seen_at = now
    db.commit()


def sweep(db: Session) -> dict:
    """Returns money from orders that can never finish: agent went silent, or nobody picked the order up."""
    now = utcnow()
    stuck = failed_to_start = 0

    for job in db.scalars(select(PrintJob).where(PrintJob.status == JOB_PRINTING, PrintJob.lease_expires_at < now)).all():
        db.execute(
            update(PrintJobItem)
            .where(PrintJobItem.job_id == job.id, PrintJobItem.status == "queued")
            .values(status="failed", failure_reason="Printer agent stopped responding")
        )
        finalize_job(db, job)
        log_event(db, action="job.stuck", target_type="job", target_id=str(job.id), detail={"station_id": job.station_id})
        stuck += 1

    cutoff = now - timedelta(seconds=config.QUEUE_TIMEOUT_SECONDS)
    for job in db.scalars(select(PrintJob).where(PrintJob.status == JOB_QUEUED, PrintJob.created_at < cutoff)).all():
        result = db.execute(
            update(PrintJob)
            .where(PrintJob.id == job.id, PrintJob.status == JOB_QUEUED)
            .values(
                status=JOB_CANCELLED, finished_at=now, updated_at=now,
                failure_reason="Not printed in time. Your money was returned.",
            )
        )
        if result.rowcount == 1:
            db.execute(update(PrintJobItem).where(PrintJobItem.job_id == job.id).values(status="cancelled"))
            if job.hold_id:
                release_hold(db, db.get(WalletHold, job.hold_id))
            log_event(db, action="job.queue_timeout", target_type="job", target_id=str(job.id), detail={"station_id": job.station_id})
            failed_to_start += 1

    db.commit()
    return {"stuck": stuck, "timed_out": failed_to_start}
