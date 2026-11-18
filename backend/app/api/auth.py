from typing import Optional

from fastapi import APIRouter, Depends, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core import config
from app.core.db import get_db
from app.core.ratelimit import RateLimiter
from app.core.security import create_access_token
from app.models.accounts import User
from app.schemas.accounts import ChangePasswordRequest, ChangePinRequest, RegisterRequest, TokenOut, UserOut
from app.services import accounts as svc

from app.schemas.accounts import ForgotPasswordRequest, ResetPasswordRequest
from app.schemas.accounts import VerifyOtpRequest

router = APIRouter(prefix="/auth", tags=["auth"])

login_limiter = RateLimiter(config.LOGIN_RATE_PER_MIN, 60)
register_limiter = RateLimiter(config.REGISTER_RATE_PER_MIN, 60)


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


@router.post("/register", response_model=UserOut, status_code=201, dependencies=[Depends(register_limiter)])
def register(body: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    return svc.register_user(
        db,
        college_id=body.college_id,
        activation_code=body.activation_code,
        password=body.password,
        station_pin=body.station_pin,
        ip=_ip(request),
    )


@router.post("/login", response_model=TokenOut, dependencies=[Depends(login_limiter)])
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = svc.authenticate(db, svc.normalize_id(form.username), form.password, _ip(request))
    return TokenOut(access_token=create_access_token(user.id, user.token_version))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/change-password", response_model=TokenOut)
def change_password(
    body: ChangePasswordRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = svc.change_password(db, user, body.current_password, body.new_password, _ip(request))
    return TokenOut(access_token=create_access_token(user.id, user.token_version))


@router.post("/change-station-pin", status_code=204)
def change_station_pin(
    body: ChangePinRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc.change_station_pin(db, user, body.password, body.new_pin, _ip(request))
    return Response(status_code=204)

@router.post("/forgot-password", status_code=204)
def forgot_password(body: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)):
    from app.core.email import send_otp_email
    otp, email = svc.request_password_reset(db, body.college_id, _ip(request))
    send_otp_email(to_email=email, otp=otp, college_id=body.college_id)
    return Response(status_code=204)


@router.post("/verify-otp", status_code=204)
def verify_otp(body: VerifyOtpRequest, request: Request, db: Session = Depends(get_db)):
    svc.check_otp_valid(db, body.college_id, body.otp, _ip(request))
    return Response(status_code=204)

@router.post("/reset-password", status_code=204)
def reset_password(body: ResetPasswordRequest, request: Request, db: Session = Depends(get_db)):
    svc.verify_otp_and_reset_password(db, body.college_id, body.otp, body.new_password, _ip(request))
    return Response(status_code=204)