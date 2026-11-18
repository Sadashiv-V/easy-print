from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.db import get_db
from app.models.accounts import User
from app.models.audit import AuditLog
from app.models.pricing import PricingRule
from app.schemas.accounts import AuditOut, BlockRequest, UserAdminOut
from app.schemas.documents import PricingChangeRequest, PricingHistoryOut
from app.services import accounts as svc
from app.services import pricing as pricing_svc
from app.services.audit import verify_chain

from app.schemas.accounts import AdminResetPasswordRequest

router = APIRouter(prefix="/admin", tags=["admin"])
admin_only = require_roles("admin")


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


@router.get("/users", response_model=List[UserAdminOut])
def list_users(
    search: str = Query("", max_length=50),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _admin: User = Depends(admin_only),
    db: Session = Depends(get_db),
):
    query = select(User).order_by(User.id).limit(limit).offset(offset)
    term = search.strip()
    if term:
        query = query.where(
            or_(User.college_id.startswith(term.upper(), autoescape=True), User.full_name.icontains(term, autoescape=True))
        )
    return db.scalars(query).all()


@router.post("/users/{user_id}/block", response_model=UserAdminOut)
def block_user(
    user_id: int, body: BlockRequest, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)
):
    return svc.set_user_blocked(db, actor=admin, target_id=user_id, blocked=True, reason=body.reason, ip=_ip(request))


@router.post("/users/{user_id}/unblock", response_model=UserAdminOut)
def unblock_user(
    user_id: int, body: BlockRequest, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)
):
    return svc.set_user_blocked(db, actor=admin, target_id=user_id, blocked=False, reason=body.reason, ip=_ip(request))


@router.get("/audit", response_model=List[AuditOut])
def recent_audit(
    limit: int = Query(50, ge=1, le=200), _admin: User = Depends(admin_only), db: Session = Depends(get_db)
):
    return db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)).all()


@router.get("/audit/verify")
def audit_verify(_admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    ok, count = verify_chain(db)
    return {"ok": ok, "entries_checked": count}


@router.post("/pricing", response_model=PricingHistoryOut, status_code=201)
def change_pricing(
    body: PricingChangeRequest, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)
):
    return pricing_svc.set_pricing(
        db,
        actor=admin,
        bw_paise=body.bw_paise_per_page,
        color_paise=body.color_paise_per_page,
        reason=body.reason,
        ip=_ip(request),
    )


@router.get("/pricing/history", response_model=List[PricingHistoryOut])
def pricing_history(
    limit: int = Query(50, ge=1, le=200), _admin: User = Depends(admin_only), db: Session = Depends(get_db)
):
    return db.scalars(select(PricingRule).order_by(PricingRule.id.desc()).limit(limit)).all()

@router.post("/users/{user_id}/reset-password", response_model=UserAdminOut)
def admin_reset_password(
    user_id: int,
    body: AdminResetPasswordRequest,
    request: Request,
    admin: User = Depends(admin_only),
    db: Session = Depends(get_db),
):
    return svc.admin_reset_password(db, actor=admin, target_id=user_id, new_password=body.new_password, ip=_ip(request))