from typing import List, Optional, Tuple

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import config
from app.core.db import utcnow
from app.core.errors import ServiceError
from app.models.accounts import User
from app.models.wallet import Wallet, WalletEntry, WalletHold
from app.services.audit import log_event

# Functions here add rows to the caller's transaction and never commit on their own,
# so a print job and its money movement succeed or fail together.


def _lock_wallet(db: Session, user_id: int) -> None:
    """Makes sure the wallet row exists and, on PostgreSQL, locks it until the transaction ends."""
    if db.scalar(select(Wallet.user_id).where(Wallet.user_id == user_id)) is None:
        try:
            with db.begin_nested():
                db.add(Wallet(user_id=user_id, balance_paise=0, updated_at=utcnow()))
        except IntegrityError:
            pass
    db.execute(select(Wallet.user_id).where(Wallet.user_id == user_id).with_for_update())


def get_balance(db: Session, user_id: int) -> int:
    return db.scalar(select(Wallet.balance_paise).where(Wallet.user_id == user_id)) or 0


def get_held(db: Session, user_id: int) -> int:
    return db.scalar(
        select(func.coalesce(func.sum(WalletHold.amount_paise), 0)).where(
            WalletHold.user_id == user_id, WalletHold.status == "active"
        )
    )


def summary(db: Session, user_id: int) -> dict:
    return {"balance_paise": get_balance(db, user_id), "held_paise": get_held(db, user_id)}


def _apply(
    db: Session,
    user_id: int,
    delta: int,
    *,
    kind: str,
    hold_id: Optional[int] = None,
    recharge_request_id: Optional[int] = None,
    reference: Optional[str] = None,
    note: Optional[str] = None,
    created_by: Optional[int] = None,
    idempotency_key: Optional[str] = None,
) -> WalletEntry:
    """One atomic statement changes the balance only if it stays >= 0, so concurrent spends cannot overdraw."""
    _lock_wallet(db, user_id)
    result = db.execute(
        update(Wallet)
        .where(Wallet.user_id == user_id, Wallet.balance_paise + delta >= 0)
        .values(balance_paise=Wallet.balance_paise + delta, updated_at=utcnow())
    )
    if result.rowcount != 1:
        raise ServiceError(402, "Insufficient wallet balance")
    entry = WalletEntry(
        user_id=user_id,
        kind=kind,
        amount_paise=delta,
        balance_after_paise=get_balance(db, user_id),
        hold_id=hold_id,
        recharge_request_id=recharge_request_id,
        idempotency_key=idempotency_key,
        reference=reference,
        note=note,
        created_by=created_by,
        created_at=utcnow(),
    )
    db.add(entry)
    db.flush()
    return entry


def post_entry(db: Session, user_id: int, delta: int, *, kind: str, idempotency_key: Optional[str] = None, **kw) -> Tuple[WalletEntry, bool]:
    """Returns (entry, replayed). The same idempotency key never posts twice."""
    if idempotency_key:
        _lock_wallet(db, user_id)
        prior = db.scalar(
            select(WalletEntry).where(WalletEntry.user_id == user_id, WalletEntry.idempotency_key == idempotency_key)
        )
        if prior:
            if prior.amount_paise != delta or prior.kind != kind:
                raise ServiceError(409, "This idempotency key was already used for a different request")
            return prior, True
    return _apply(db, user_id, delta, kind=kind, idempotency_key=idempotency_key, **kw), False


def list_entries(db: Session, user_id: int, limit: int = 50, offset: int = 0) -> List[WalletEntry]:
    return list(
        db.scalars(
            select(WalletEntry)
            .where(WalletEntry.user_id == user_id)
            .order_by(WalletEntry.id.desc())
            .limit(limit)
            .offset(offset)
        )
    )


# ---- holds (used by print jobs) ----

def place_hold(
    db: Session, *, user_id: int, amount: int, reference: Optional[str], idempotency_key: Optional[str]
) -> WalletHold:
    if amount <= 0:
        raise ServiceError(422, "Hold amount must be positive")
    _lock_wallet(db, user_id)
    if idempotency_key:
        prior = db.scalar(
            select(WalletHold).where(WalletHold.user_id == user_id, WalletHold.idempotency_key == idempotency_key)
        )
        if prior:
            if prior.amount_paise != amount:
                raise ServiceError(409, "This idempotency key was already used for a different request")
            return prior
    hold = WalletHold(
        user_id=user_id,
        amount_paise=amount,
        status="active",
        reference=reference,
        idempotency_key=idempotency_key,
        created_at=utcnow(),
    )
    db.add(hold)
    db.flush()
    _apply(db, user_id, -amount, kind="hold", hold_id=hold.id, reference=reference)
    return hold


def _transition(db: Session, hold: WalletHold, expected: str, new: str) -> None:
    result = db.execute(
        update(WalletHold)
        .where(WalletHold.id == hold.id, WalletHold.status == expected)
        .values(status=new, resolved_at=utcnow())
    )
    if result.rowcount != 1:
        raise ServiceError(409, f"This hold is not {expected}")
    db.refresh(hold)


def capture_hold(db: Session, hold: WalletHold) -> WalletEntry:
    _lock_wallet(db, hold.user_id)
    _transition(db, hold, "active", "captured")
    hold.captured_paise = hold.amount_paise
    return _apply(db, hold.user_id, 0, kind="capture", hold_id=hold.id, reference=hold.reference)


def settle_hold(db: Session, hold: WalletHold, *, charge: int) -> WalletEntry:
    """Charges `charge` paise of the hold and returns the rest to the wallet."""
    if charge < 0 or charge > hold.amount_paise:
        raise ServiceError(422, "Charge must be between zero and the held amount")
    if charge == hold.amount_paise:
        return capture_hold(db, hold)
    if charge == 0:
        return release_hold(db, hold)
    _lock_wallet(db, hold.user_id)
    _transition(db, hold, "active", "captured")
    hold.captured_paise = charge
    _apply(db, hold.user_id, 0, kind="capture", hold_id=hold.id, reference=hold.reference, note="Charged for pages printed")
    return _apply(
        db, hold.user_id, hold.amount_paise - charge, kind="release", hold_id=hold.id,
        reference=hold.reference, note="Returned for pages not printed",
    )


def release_hold(db: Session, hold: WalletHold) -> WalletEntry:
    _lock_wallet(db, hold.user_id)
    _transition(db, hold, "active", "released")
    return _apply(db, hold.user_id, hold.amount_paise, kind="release", hold_id=hold.id, reference=hold.reference)


def refund_hold(db: Session, hold: WalletHold, *, created_by: Optional[int], note: Optional[str]) -> WalletEntry:
    _lock_wallet(db, hold.user_id)
    _transition(db, hold, "captured", "refunded")
    amount = hold.captured_paise if hold.captured_paise is not None else hold.amount_paise
    return _apply(
        db, hold.user_id, amount, kind="refund", hold_id=hold.id,
        reference=hold.reference, note=note, created_by=created_by,
    )


# ---- admin actions ----

def _get_wallet_owner(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if not user or user.role not in ("student", "staff"):
        raise ServiceError(404, "Student or staff account not found")
    return user


def admin_adjust(
    db: Session, *, actor: User, user_id: int, amount: int, kind: str, reason: str,
    idempotency_key: Optional[str], ip: Optional[str],
) -> WalletEntry:
    _get_wallet_owner(db, user_id)
    if amount == 0 or abs(amount) > config.MAX_ADJUST_PAISE:
        raise ServiceError(422, f"Amount must be non-zero and at most {config.MAX_ADJUST_PAISE} paise")
    if kind == "recharge" and amount < 0:
        raise ServiceError(422, "A recharge must be a positive amount; use an adjustment to deduct")
    entry, replayed = post_entry(
        db, user_id, amount, kind=kind, idempotency_key=idempotency_key, note=reason, created_by=actor.id
    )
    if not replayed:
        log_event(
            db, action="admin.wallet_adjust", actor_id=actor.id, target_type="user", target_id=str(user_id),
            reason=reason, ip=ip, detail={"entry_id": entry.id, "kind": kind, "amount_paise": amount},
        )
    db.commit()
    return entry


def admin_refund_hold(db: Session, *, actor: User, hold_id: int, reason: str, ip: Optional[str]) -> WalletEntry:
    hold = db.get(WalletHold, hold_id)
    if not hold:
        raise ServiceError(404, "Hold not found")
    entry = refund_hold(db, hold, created_by=actor.id, note=reason)
    log_event(
        db, action="admin.refund", actor_id=actor.id, target_type="user", target_id=str(hold.user_id),
        reason=reason, ip=ip, detail={"hold_id": hold.id, "amount_paise": hold.amount_paise},
    )
    db.commit()
    return entry


def admin_wallet_view(db: Session, user_id: int) -> dict:
    user = _get_wallet_owner(db, user_id)
    return {
        "user_id": user.id,
        "college_id": user.college_id,
        "full_name": user.full_name,
        **summary(db, user_id),
        "entries": list_entries(db, user_id, limit=50),
    }


def reconcile(db: Session, limit: int = 50) -> dict:
    """Compares each cached balance with the sum of its ledger. Any mismatch means something bypassed the rules."""
    ledger = dict(db.execute(select(WalletEntry.user_id, func.sum(WalletEntry.amount_paise)).group_by(WalletEntry.user_id)).all())
    wallets = db.execute(select(Wallet.user_id, Wallet.balance_paise)).all()
    mismatches = [
        {"user_id": uid, "cached_paise": bal, "ledger_paise": ledger.get(uid, 0)}
        for uid, bal in wallets
        if ledger.get(uid, 0) != bal
    ]
    held = db.scalar(select(func.coalesce(func.sum(WalletHold.amount_paise), 0)).where(WalletHold.status == "active"))
    return {
        "wallets_checked": len(wallets),
        "mismatch_count": len(mismatches),
        "mismatches": mismatches[:limit],
        "total_balance_paise": sum(bal for _, bal in wallets),
        "total_held_paise": held,
    }
