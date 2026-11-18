from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.config import MAX_COPIES

ColorMode = Literal["bw", "color"]


class DocumentSettings(BaseModel):
    color_mode: Optional[ColorMode] = None
    duplex: Optional[bool] = None
    copies: Optional[int] = Field(None, ge=1, le=MAX_COPIES)
    page_ranges: Optional[str] = Field(None, max_length=200)

    @model_validator(mode="after")
    def _not_empty(self):
        if all(v is None for v in (self.color_mode, self.duplex, self.copies, self.page_ranges)):
            raise ValueError("Provide at least one setting to change")
        return self


class DocumentOut(BaseModel):
    id: int
    original_name: str
    size_bytes: int
    page_count: int
    color_mode: str
    duplex: bool
    copies: int
    page_ranges: str
    selected_pages: int
    rate_paise_per_page: int
    estimated_price_paise: int
    created_at: datetime
    expires_at: datetime


class PricingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    bw_paise_per_page: int
    color_paise_per_page: int
    created_at: datetime


class PricingHistoryOut(PricingOut):
    created_by: Optional[int] = None
    reason: Optional[str] = None


class PricingChangeRequest(BaseModel):
    bw_paise_per_page: int = Field(ge=0, le=100000)
    color_paise_per_page: int = Field(ge=0, le=100000)
    reason: str = Field(min_length=3, max_length=200)

    @field_validator("reason")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()
