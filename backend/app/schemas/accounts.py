from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.security import check_password_policy, check_station_pin_policy, normalize_activation_code


class RegisterRequest(BaseModel):
    college_id: str = Field(min_length=4, max_length=32)
    activation_code: str = Field(min_length=6, max_length=20)
    password: str = Field(min_length=8, max_length=128)
    station_pin: str = Field(min_length=4, max_length=6)

    @field_validator("college_id")
    @classmethod
    def _id(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("activation_code")
    @classmethod
    def _code(cls, v: str) -> str:
        return normalize_activation_code(v)

    @model_validator(mode="after")
    def _policies(self):
        check_password_policy(self.password, self.college_id)
        check_station_pin_policy(self.station_pin)
        return self


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(min_length=8, max_length=128)


class ChangePinRequest(BaseModel):
    password: str = Field(max_length=256)
    new_pin: str = Field(min_length=4, max_length=6)


class BlockRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=200)

    @field_validator("reason")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    college_id: str
    full_name: str
    role: str
    status: str
    created_at: datetime


class UserAdminOut(UserOut):
    blocked_reason: Optional[str] = None
    last_login_at: Optional[datetime] = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    actor_id: Optional[int] = None
    action: str
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    reason: Optional[str] = None
    ip: Optional[str] = None

class ForgotPasswordRequest(BaseModel):
    college_id: str = Field(min_length=4, max_length=32)

    @field_validator("college_id")
    @classmethod
    def _id(cls, v: str) -> str:
        return v.strip().upper()


class ResetPasswordRequest(BaseModel):
    college_id: str = Field(min_length=4, max_length=32)
    otp: str = Field(min_length=4, max_length=20)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("college_id")
    @classmethod
    def _id(cls, v: str) -> str:
        return v.strip().upper()


class AdminResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)

class VerifyOtpRequest(BaseModel):
    college_id: str = Field(min_length=4, max_length=32)
    otp: str = Field(min_length=4, max_length=20)

    @field_validator("college_id")
    @classmethod
    def _id(cls, v: str) -> str:
        return v.strip().upper()