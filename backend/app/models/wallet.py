from datetime import datetime
from typing import Optional

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow


class Wallet(Base):
    """Cached spendable balance. The ledger (WalletEntry) is the source of truth; this row is kept in step."""

    __tablename__ = "wallets"
    __table_args__ = (CheckConstraint("balance_paise >= 0", name="non_negative"),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True, autoincrement=False)
    balance_paise: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class WalletHold(Base):
    """Money reserved for a print job: active -> captured | released, and captured -> refunded."""

    __tablename__ = "wallet_holds"
    __table_args__ = (UniqueConstraint("user_id", "idempotency_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    amount_paise: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(12), default="active", index=True)
    reference: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    captured_paise: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class RechargeRequest(Base):
    __tablename__ = "recharge_requests"
    __table_args__ = (
        Index(
            "uq_recharge_active_reference",
            "reference",
            unique=True,
            sqlite_where=text("status IN ('pending','approved')"),
            postgresql_where=text("status IN ('pending','approved')"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    amount_paise: Mapped[int] = mapped_column(Integer)
    reference: Mapped[str] = mapped_column(String(64))
    note: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="pending", index=True)
    decided_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    decision_note: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class WalletEntry(Base):
    """Append-only ledger. amount_paise is signed; balance_after_paise is the balance once it was applied."""

    __tablename__ = "wallet_entries"
    __table_args__ = (UniqueConstraint("user_id", "idempotency_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # recharge | adjustment | hold | capture | release | refund
    amount_paise: Mapped[int] = mapped_column(Integer)
    balance_after_paise: Mapped[int] = mapped_column(Integer)
    hold_id: Mapped[Optional[int]] = mapped_column(ForeignKey("wallet_holds.id"), nullable=True)
    recharge_request_id: Mapped[Optional[int]] = mapped_column(ForeignKey("recharge_requests.id"), nullable=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    reference: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
