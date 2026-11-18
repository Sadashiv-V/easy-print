from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core import config


class WalletOut(BaseModel):
    balance_paise: int
    held_paise: int


class EntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    amount_paise: int
    balance_after_paise: int
    hold_id: Optional[int] = None
    recharge_request_id: Optional[int] = None
    reference: Optional[str] = None
    note: Optional[str] = None
    created_at: datetime


class RechargeCreate(BaseModel):
    amount_paise: int = Field(ge=config.RECHARGE_MIN_PAISE, le=config.RECHARGE_MAX_PAISE)
    reference: str = Field(min_length=3, max_length=64)
    note: Optional[str] = Field(None, max_length=200)

    @field_validator("reference", "note")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v


class RechargeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    amount_paise: int
    reference: str
    note: Optional[str] = None
    status: str
    decision_note: Optional[str] = None
    decided_at: Optional[datetime] = None
    created_at: datetime


class RechargeAdminOut(RechargeOut):
    college_id: Optional[str] = None
    full_name: Optional[str] = None


class ApproveRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=200)


class RejectRequest(BaseModel):
    note: str = Field(min_length=3, max_length=200)

    @field_validator("note")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class AdjustRequest(BaseModel):
    amount_paise: int = Field(description="Positive to add money, negative to deduct")
    kind: Literal["recharge", "adjustment"] = "adjustment"
    reason: str = Field(min_length=3, max_length=200)
    idempotency_key: Optional[str] = Field(None, min_length=8, max_length=64)

    @field_validator("reason")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class RefundRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=200)

    @field_validator("reason")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class AdminWalletOut(WalletOut):
    user_id: int
    college_id: str
    full_name: str
    entries: List[EntryOut]


class ReconcileOut(BaseModel):
    wallets_checked: int
    mismatch_count: int
    mismatches: List[dict]
    total_balance_paise: int
    total_held_paise: int
