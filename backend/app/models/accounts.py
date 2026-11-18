from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow


class RosterEntry(Base):
    """The college's official list. Nobody can register unless they are on it."""

    __tablename__ = "roster_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    college_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(16))  # student | staff
    admission_year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    admission_type: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    branch_code: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    activation_hash: Mapped[str] = mapped_column(String(255))
    activation_failed: Mapped[int] = mapped_column(Integer, default=0)
    activation_locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    claimed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    roster_id: Mapped[Optional[int]] = mapped_column(ForeignKey("roster_entries.id"), unique=True, nullable=True)
    college_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(16))  # student | staff | operator | admin | viewer
    password_hash: Mapped[str] = mapped_column(String(255))
    station_pin_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="active")  # active | blocked
    blocked_reason: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    pin_failed_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    pin_locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

class PasswordResetToken(Base):
    """One-time OTP for self-service password reset via email."""

    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    otp_hash: Mapped[str] = mapped_column(String(255))          # hashed OTP
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    used: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)