from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow

JOB_QUEUED = "queued"
JOB_PRINTING = "printing"
JOB_COMPLETED = "completed"
JOB_FAILED = "failed"
JOB_CANCELLED = "cancelled"
JOB_PARTIAL = "partial"
ACTIVE_JOB_STATUSES = (JOB_QUEUED, JOB_PRINTING)


class PrintJob(Base):
    """One station visit's print order. Prices and settings are snapshotted so history never changes."""

    __tablename__ = "print_jobs"
    __table_args__ = (UniqueConstraint("user_id", "idempotency_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"), index=True)
    session_id: Mapped[Optional[int]] = mapped_column(ForeignKey("station_sessions.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(12), default=JOB_QUEUED, index=True)
    total_paise: Mapped[int] = mapped_column(Integer)
    pricing_rule_id: Mapped[int] = mapped_column(ForeignKey("pricing_rules.id"))
    hold_id: Mapped[Optional[int]] = mapped_column(ForeignKey("wallet_holds.id"), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(64))
    failure_reason: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    lease_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class PrintJobItem(Base):
    __tablename__ = "print_job_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("print_jobs.id"), index=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), index=True)
    document_name: Mapped[str] = mapped_column(String(150))
    copies: Mapped[int] = mapped_column(Integer)
    color_mode: Mapped[str] = mapped_column(String(8))
    duplex: Mapped[bool] = mapped_column(Boolean)
    page_ranges: Mapped[str] = mapped_column(String(200))
    selected_pages: Mapped[int] = mapped_column(Integer)
    rate_paise_per_page: Mapped[int] = mapped_column(Integer)
    price_paise: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(12), default="queued")
    failure_reason: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
