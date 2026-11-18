from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.config import MAX_COPIES


class StationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    location: Optional[str] = Field(None, max_length=100)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class StationOut(BaseModel):
    id: int
    name: str
    location: Optional[str] = None
    status: str
    last_seen_at: Optional[datetime] = None
    created_at: datetime
    in_use: bool = False
    printer_status: str = "unknown"
    printer_message: Optional[str] = None
    printer_status_at: Optional[datetime] = None
    printer_ok: bool = True
    agent_configured: bool = False


class StationWithKeyOut(StationOut):
    station_key: str = Field(description="Kiosk key, shown once. Only lets the kiosk screen log students in.")
    agent_key: Optional[str] = Field(None, description="Print-agent key, shown once. Keep it only in the agent program, never in a browser.")


class AgentKeyOut(BaseModel):
    id: int
    agent_key: str


class PrinterStateOut(BaseModel):
    printer_available: bool
    printer_status: str
    message: Optional[str] = None


class ReasonRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=200)

    @field_validator("reason")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class StationLoginRequest(BaseModel):
    college_id: str = Field(min_length=4, max_length=32)
    pin: str = Field(min_length=4, max_length=6, pattern=r"^\d+$")

    @field_validator("college_id")
    @classmethod
    def _id(cls, v: str) -> str:
        return v.strip().upper()


class StationUserOut(BaseModel):
    college_id: str
    full_name: str
    balance_paise: int
    held_paise: int
    session_expires_at: datetime
    idle_timeout_seconds: int


class StationLoginOut(StationUserOut):
    session_token: str


class PrintItemIn(BaseModel):
    document_id: int
    copies: Optional[int] = Field(None, ge=1, le=MAX_COPIES, description="Leave empty to use the copies chosen at upload")


class QuoteRequest(BaseModel):
    items: List[PrintItemIn] = Field(min_length=1, max_length=30)


class PrintRequest(QuoteRequest):
    idempotency_key: str = Field(min_length=8, max_length=64, description="A fresh random value per click; retries reuse it")


class QuoteLineOut(BaseModel):
    document_id: int
    original_name: str
    copies: int
    selected_pages: int
    color_mode: str
    duplex: bool
    rate_paise_per_page: int
    price_paise: int


class QuoteOut(BaseModel):
    lines: List[QuoteLineOut]
    total_pages: int
    total_paise: int
    balance_paise: int
    sufficient: bool
    shortfall_paise: int


class JobItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    document_id: int
    document_name: str
    copies: int
    color_mode: str
    duplex: bool
    page_ranges: str
    selected_pages: int
    price_paise: int
    status: str


class JobOut(BaseModel):
    id: int
    status: str
    station_id: int
    total_paise: int
    failure_reason: Optional[str] = None
    created_at: datetime
    finished_at: Optional[datetime] = None
    items: List[JobItemOut]
