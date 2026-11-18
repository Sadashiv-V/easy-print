from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow


class Station(Base):
    """A physical print station. It proves itself with a secret key that only its hash is stored for."""

    __tablename__ = "stations"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True)
    location: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    key_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(10), default="active")  # active | inactive
    agent_key_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    printer_status: Mapped[str] = mapped_column(String(12), default="unknown", server_default="unknown")
    printer_message: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    printer_status_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class StationSession(Base):
    """One student's visit at one station. Only the hash of the session token is stored."""

    __tablename__ = "station_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_activity_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    end_reason: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
