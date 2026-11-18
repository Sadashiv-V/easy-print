from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, utcnow


class PricingRule(Base):
    """Append-only price history. The newest row is the current price; old rows explain past charges."""

    __tablename__ = "pricing_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    bw_paise_per_page: Mapped[int] = mapped_column(Integer)
    color_paise_per_page: Mapped[int] = mapped_column(Integer)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
