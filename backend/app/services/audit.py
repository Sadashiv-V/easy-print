import hashlib
import json
from typing import Optional, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.models.audit import AuditLog

GENESIS = "0" * 64


def _digest(prev_hash: str, row: AuditLog) -> str:
    payload = {
        "created_at": row.created_at.isoformat(),
        "actor_id": row.actor_id,
        "action": row.action,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "reason": row.reason,
        "ip": row.ip,
        "detail": row.detail,
    }
    raw = prev_hash + json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def log_event(
    db: Session,
    *,
    action: str,
    actor_id: Optional[int] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    reason: Optional[str] = None,
    ip: Optional[str] = None,
    detail: Optional[dict] = None,
) -> None:
    """Adds an audit row to the current transaction; the caller commits."""
    last = db.scalar(select(AuditLog.entry_hash).order_by(AuditLog.id.desc()).limit(1))
    prev = last or GENESIS
    row = AuditLog(
        created_at=utcnow(),
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        reason=reason,
        ip=ip,
        detail=json.dumps(detail, sort_keys=True) if detail else None,
        prev_hash=prev,
        entry_hash="",
    )
    row.entry_hash = _digest(prev, row)
    db.add(row)
    db.flush()


def verify_chain(db: Session) -> Tuple[bool, int]:
    prev = GENESIS
    count = 0
    for row in db.scalars(select(AuditLog).order_by(AuditLog.id)):
        if row.prev_hash != prev or row.entry_hash != _digest(prev, row):
            return False, count
        prev = row.entry_hash
        count += 1
    return True, count
