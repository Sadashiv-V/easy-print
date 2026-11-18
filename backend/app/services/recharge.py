import re
from typing import List, Optional

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core import config
from app.core.db import utcnow
from app.core.errors import ServiceError
from app.models.accounts import User
from app.models.wallet import RechargeRequest
from app.schemas.wallet import RechargeAdminOut
from app.services.audit import log_event
from app.services.wallet import post_entry


def normalize_reference(raw: str) -> str:
    return re.sub(r"\s+", "", raw or "").upper()[:64]


def create_request(db: Session, user: User, *, amount: int, reference: str, note: Optional[str]) -> RechargeRequest:
    if not config.RECHARGE_MIN_PAISE <= amount <= config.RECHARGE_MAX_PAISE:
        raise ServiceError(
            422,
            f"Recharge must be between {config.RECHARGE_MIN_PAISE // 100} and {config.RECHARGE_MAX_PAISE // 100} rupees",
        )
    ref = normalize_reference(reference)
    if len(ref) < 3:
        raise ServiceError(422, "Enter the receipt or transaction number")

    pending = db.scalar(
        select(func.count(RechargeRequest.id)).where(
            RechargeRequest.user_id == user.id, RechargeRequest.status == "pending"
        )
    )
    if pending >= config.MAX_PENDING_RECHARGES:
        raise ServiceError(409, "You already have several pending requests. Wait for them to be reviewed.")
    clash = db.scalar(
        select(RechargeRequest.id).where(
            RechargeRequest.reference == ref, RechargeRequest.status.in_(("pending", "approved"))
        )
    )
    if clash:
        raise ServiceError(409, "That receipt or transaction number has already been submitted")

    req = RechargeRequest(user_id=user.id, amount_paise=amount, reference=ref, note=note, created_at=utcnow())
    db.add(req)
    db.commit()
    return req


def list_mine(db: Session, user: User) -> List[RechargeRequest]:
    return list(
        db.scalars(
            select(RechargeRequest).where(RechargeRequest.user_id == user.id).order_by(RechargeRequest.id.desc()).limit(50)
        )
    )


def _decide(db: Session, req_id: int, new_status: str, by: Optional[int], note: Optional[str]) -> RechargeRequest:
    result = db.execute(
        update(RechargeRequest)
        .where(RechargeRequest.id == req_id, RechargeRequest.status == "pending")
        .values(status=new_status, decided_by=by, decided_at=utcnow(), decision_note=note)
    )
    if result.rowcount != 1:
        exists = db.scalar(select(RechargeRequest.id).where(RechargeRequest.id == req_id))
        raise ServiceError(409 if exists else 404, "This request is no longer pending" if exists else "Request not found")
    req = db.get(RechargeRequest, req_id)
    db.refresh(req)
    return req


def cancel(db: Session, user: User, req_id: int) -> RechargeRequest:
    owner = db.scalar(select(RechargeRequest.user_id).where(RechargeRequest.id == req_id))
    if owner != user.id:
        raise ServiceError(404, "Request not found")
    req = _decide(db, req_id, "cancelled", None, None)
    db.commit()
    return req


def list_admin(db: Session, status: str, limit: int, offset: int) -> List[RechargeAdminOut]:
    rows = db.execute(
        select(RechargeRequest, User)
        .join(User, User.id == RechargeRequest.user_id)
        .where(RechargeRequest.status == status)
        .order_by(RechargeRequest.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return [
        RechargeAdminOut.model_validate(req, from_attributes=True).model_copy(
            update={"college_id": user.college_id, "full_name": user.full_name}
        )
        for req, user in rows
    ]


def approve(db: Session, admin: User, req_id: int, note: Optional[str], ip: Optional[str]) -> RechargeRequest:
    req = _decide(db, req_id, "approved", admin.id, note)
    entry, _ = post_entry(
        db, req.user_id, req.amount_paise, kind="recharge",
        recharge_request_id=req.id, reference=req.reference, note=note, created_by=admin.id,
    )
    log_event(
        db, action="admin.recharge_approve", actor_id=admin.id, target_type="user", target_id=str(req.user_id),
        reason=note, ip=ip, detail={"request_id": req.id, "amount_paise": req.amount_paise, "entry_id": entry.id},
    )
    db.commit()
    return req


def reject(db: Session, admin: User, req_id: int, note: str, ip: Optional[str]) -> RechargeRequest:
    req = _decide(db, req_id, "rejected", admin.id, note)
    log_event(
        db, action="admin.recharge_reject", actor_id=admin.id, target_type="user", target_id=str(req.user_id),
        reason=note, ip=ip, detail={"request_id": req.id},
    )
    db.commit()
    return req
