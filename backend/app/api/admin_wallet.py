from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.db import get_db
from app.models.accounts import User
from app.schemas.wallet import (
    AdjustRequest,
    AdminWalletOut,
    ApproveRequest,
    EntryOut,
    RechargeAdminOut,
    RechargeOut,
    ReconcileOut,
    RefundRequest,
    RejectRequest,
)
from app.services import recharge as recharge_svc
from app.services import wallet as wallet_svc

router = APIRouter(prefix="/admin", tags=["admin-wallet"])
admin_only = require_roles("admin")


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


@router.get("/recharge-requests", response_model=List[RechargeAdminOut])
def list_recharge_requests(
    status: Literal["pending", "approved", "rejected", "cancelled"] = "pending",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _admin: User = Depends(admin_only),
    db: Session = Depends(get_db),
):
    return recharge_svc.list_admin(db, status, limit, offset)


@router.post("/recharge-requests/{request_id}/approve", response_model=RechargeOut)
def approve_recharge(
    request_id: int, body: ApproveRequest, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)
):
    return recharge_svc.approve(db, admin, request_id, body.note, _ip(request))


@router.post("/recharge-requests/{request_id}/reject", response_model=RechargeOut)
def reject_recharge(
    request_id: int, body: RejectRequest, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)
):
    return recharge_svc.reject(db, admin, request_id, body.note, _ip(request))


@router.get("/wallets/{user_id}", response_model=AdminWalletOut)
def view_wallet(user_id: int, _admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    return wallet_svc.admin_wallet_view(db, user_id)


@router.post("/wallets/{user_id}/adjust", response_model=EntryOut, status_code=201)
def adjust_wallet(
    user_id: int, body: AdjustRequest, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)
):
    return wallet_svc.admin_adjust(
        db, actor=admin, user_id=user_id, amount=body.amount_paise, kind=body.kind,
        reason=body.reason, idempotency_key=body.idempotency_key, ip=_ip(request),
    )


@router.post("/holds/{hold_id}/refund", response_model=EntryOut)
def refund_hold(
    hold_id: int, body: RefundRequest, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)
):
    return wallet_svc.admin_refund_hold(db, actor=admin, hold_id=hold_id, reason=body.reason, ip=_ip(request))


@router.get("/wallet-reconcile", response_model=ReconcileOut)
def reconcile(_admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    return wallet_svc.reconcile(db)
