from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.db import get_db
from app.models.accounts import User
from app.schemas.wallet import EntryOut, RechargeCreate, RechargeOut, WalletOut
from app.services import recharge as recharge_svc
from app.services import wallet as wallet_svc

router = APIRouter(prefix="/wallet", tags=["wallet"])
owner_roles = require_roles("student", "staff")


@router.get("", response_model=WalletOut)
def my_wallet(user: User = Depends(owner_roles), db: Session = Depends(get_db)):
    return wallet_svc.summary(db, user.id)


@router.get("/entries", response_model=List[EntryOut])
def my_statement(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(owner_roles),
    db: Session = Depends(get_db),
):
    return wallet_svc.list_entries(db, user.id, limit, offset)


@router.post("/recharge-requests", response_model=RechargeOut, status_code=201)
def request_recharge(body: RechargeCreate, user: User = Depends(owner_roles), db: Session = Depends(get_db)):
    return recharge_svc.create_request(db, user, amount=body.amount_paise, reference=body.reference, note=body.note)


@router.get("/recharge-requests", response_model=List[RechargeOut])
def my_recharge_requests(user: User = Depends(owner_roles), db: Session = Depends(get_db)):
    return recharge_svc.list_mine(db, user)


@router.post("/recharge-requests/{request_id}/cancel", response_model=RechargeOut)
def cancel_recharge(request_id: int, user: User = Depends(owner_roles), db: Session = Depends(get_db)):
    return recharge_svc.cancel(db, user, request_id)
