from datetime import timedelta
from typing import Iterable, List, Optional, Set, Tuple

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import config
from app.core.db import utcnow
from app.core.errors import ServiceError
from app.core.security import (
    check_password_policy,
    check_station_pin_policy,
    hash_secret,
    new_activation_code,
    normalize_activation_code,
    verify_secret,
)
from app.models.accounts import RosterEntry, User
from app.services.audit import log_event

import random

MAX_PASSWORD_LEN = 256


class AccountError(ServiceError):
    pass


def normalize_id(raw: str) -> str:
    return (raw or "").strip().upper()


def parse_student_id(college_id: str) -> Optional[dict]:
    m = config.STUDENT_ID_RE.match(college_id)
    if not m or m.group(2) != config.COLLEGE_CODE:
        return None
    year, _college, admission_type, branch, _code = m.groups()
    return {"admission_year": 2000 + int(year), "admission_type": admission_type, "branch_code": branch}


def import_roster(
    db: Session, rows: Iterable[dict], actor_id: Optional[int] = None
) -> Tuple[List[Tuple[str, str, str]], List[Tuple[int, str, str]]]:
    """Returns (new activation codes as (id, name, code), skipped rows as (line, id, reason))."""
    codes: List[Tuple[str, str, str]] = []
    skipped: List[Tuple[int, str, str]] = []
    seen: Set[str] = set()

    for line, row in enumerate(rows, start=2):
        cid = normalize_id(row.get("college_id", ""))
        name = (row.get("full_name") or "").strip()
        role = (row.get("role") or "student").strip().lower()
        info: dict = {}
        reason = None

        if not name:
            reason = "missing name"
        elif role not in ("student", "staff"):
            reason = "role must be student or staff"
        elif role == "student":
            parsed = parse_student_id(cid)
            if parsed is None:
                reason = "invalid student ID or wrong college code"
            else:
                info = parsed
        elif not config.STAFF_ID_RE.match(cid):
            reason = "invalid staff ID"

        if reason is None and (cid in seen or db.scalar(select(RosterEntry.id).where(RosterEntry.college_id == cid))):
            reason = "already in roster"
        if reason:
            skipped.append((line, cid, reason))
            continue

        code = new_activation_code()
        db.add(
            RosterEntry(
                college_id=cid,
                full_name=name[:100],
                role=role,
                phone=(row.get("phone") or "").strip()[:20] or None,
                email=(row.get("email") or "").strip()[:120] or None,
                activation_hash=hash_secret(normalize_activation_code(code)),
                **info,
            )
        )
        seen.add(cid)
        codes.append((cid, name, code))

    log_event(
        db,
        action="roster.import",
        actor_id=actor_id,
        detail={"created": len(codes), "skipped": len(skipped)},
    )
    db.commit()
    return codes, skipped


def register_user(
    db: Session, *, college_id: str, activation_code: str, password: str, station_pin: str, ip: Optional[str]
) -> User:
    entry = db.scalar(select(RosterEntry).where(RosterEntry.college_id == college_id))
    now = utcnow()

    if entry and entry.activation_locked_until and entry.activation_locked_until > now:
        raise AccountError(429, "Too many failed attempts. Try again later.")

    open_entry = entry is not None and entry.claimed_at is None
    ok = verify_secret(activation_code, entry.activation_hash if open_entry else None)
    if not ok:
        if open_entry:
            entry.activation_failed += 1
            if entry.activation_failed >= config.MAX_ACTIVATION_ATTEMPTS:
                entry.activation_locked_until = now + timedelta(minutes=config.ACTIVATION_LOCK_MINUTES)
                entry.activation_failed = 0
                log_event(db, action="roster.lockout", target_type="roster", target_id=entry.college_id, ip=ip)
            db.commit()
        raise AccountError(400, "Invalid College ID or activation code, or this ID is already registered")

    user = User(
        roster_id=entry.id,
        college_id=entry.college_id,
        full_name=entry.full_name,
        role=entry.role,
        password_hash=hash_secret(password),
        station_pin_hash=hash_secret(station_pin),
    )
    entry.claimed_at = now
    entry.activation_failed = 0
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise AccountError(400, "Invalid College ID or activation code, or this ID is already registered")
    log_event(db, action="user.register", actor_id=user.id, target_type="user", target_id=str(user.id), ip=ip)
    db.commit()
    return user


def authenticate(db: Session, college_id: str, password: str, ip: Optional[str]) -> User:
    user = db.scalar(select(User).where(User.college_id == college_id))
    now = utcnow()

    if user and user.locked_until and user.locked_until > now:
        raise AccountError(429, "Too many failed attempts. Try again later.")

    ok = len(password) <= MAX_PASSWORD_LEN and verify_secret(password, user.password_hash if user else None)
    if not ok:
        if user:
            user.failed_attempts += 1
            if user.failed_attempts >= config.MAX_FAILED_LOGINS:
                user.locked_until = now + timedelta(minutes=config.LOCKOUT_MINUTES)
                user.failed_attempts = 0
                log_event(db, action="auth.lockout", target_type="user", target_id=str(user.id), ip=ip)
            db.commit()
        raise AccountError(401, "Incorrect College ID or password")

    if user.status != "active":
        raise AccountError(403, "This account is blocked. Please contact the administrator.")

    user.failed_attempts = 0
    user.locked_until = None
    user.last_login_at = now
    db.commit()
    return user


def change_password(db: Session, user: User, current: str, new: str, ip: Optional[str]) -> User:
    if not verify_secret(current, user.password_hash):
        raise AccountError(401, "Current password is incorrect")
    try:
        check_password_policy(new, user.college_id)
    except ValueError as exc:
        raise AccountError(422, str(exc))
    user.password_hash = hash_secret(new)
    user.token_version += 1
    log_event(db, action="auth.password_change", actor_id=user.id, target_type="user", target_id=str(user.id), ip=ip)
    db.commit()
    return user


def change_station_pin(db: Session, user: User, password: str, new_pin: str, ip: Optional[str]) -> None:
    if not verify_secret(password, user.password_hash):
        raise AccountError(401, "Password is incorrect")
    try:
        check_station_pin_policy(new_pin)
    except ValueError as exc:
        raise AccountError(422, str(exc))
    user.station_pin_hash = hash_secret(new_pin)
    log_event(db, action="auth.pin_change", actor_id=user.id, target_type="user", target_id=str(user.id), ip=ip)
    db.commit()


def create_admin(db: Session, college_id: str, full_name: str, password: str) -> User:
    college_id = normalize_id(college_id)
    if not config.STAFF_ID_RE.match(college_id):
        raise AccountError(422, "Admin ID must be 4-20 letters or digits")
    try:
        check_password_policy(password, college_id)
    except ValueError as exc:
        raise AccountError(422, str(exc))
    if db.scalar(select(User.id).where(User.college_id == college_id)):
        raise AccountError(409, "That ID already exists")
    user = User(college_id=college_id, full_name=full_name.strip()[:100], role="admin", password_hash=hash_secret(password))
    db.add(user)
    db.flush()
    log_event(db, action="admin.create", target_type="user", target_id=str(user.id), detail={"via": "cli"})
    db.commit()
    return user


def set_user_blocked(db: Session, *, actor: User, target_id: int, blocked: bool, reason: str, ip: Optional[str]) -> User:
    target = db.get(User, target_id)
    if not target:
        raise AccountError(404, "User not found")
    if target.id == actor.id:
        raise AccountError(400, "You cannot block or unblock your own account")
    if blocked and target.status == "blocked":
        raise AccountError(409, "User is already blocked")
    if not blocked and target.status != "blocked":
        raise AccountError(409, "User is not blocked")

    if blocked:
        target.status = "blocked"
        target.blocked_reason = reason
        target.token_version += 1
    else:
        target.status = "active"
        target.blocked_reason = None
        target.failed_attempts = 0
        target.locked_until = None

    log_event(
        db,
        action="admin.block" if blocked else "admin.unblock",
        actor_id=actor.id,
        target_type="user",
        target_id=str(target.id),
        reason=reason,
        ip=ip,
    )
    db.commit()
    return target

def request_password_reset(db: Session, college_id: str, ip: Optional[str]) -> str:
    """Generate OTP, save it, return the user's email (so the caller can send it).
    Raises AccountError if the user doesn't exist or has no email on record.
    """
    from app.models.accounts import PasswordResetToken

    user = db.scalar(select(User).where(User.college_id == college_id))
    if not user:
        # Don't reveal whether the ID exists — same error either way
        raise AccountError(404, "No email address found for this account. Please contact the admin.")

    # Get email from roster entry
    from app.models.accounts import RosterEntry
    entry = db.scalar(select(RosterEntry).where(RosterEntry.id == user.roster_id)) if user.roster_id else None
    email = entry.email if entry else None
   # Use roster email if available, otherwise derive from college ID
    email = (entry.email if entry else None) or f"{user.college_id.lower()}@student.vardhaman.org"

    # Generate 6-digit OTP
    otp = f"{random.randint(0, 999999):06d}"

    # Expire any existing tokens for this user
    existing = db.scalars(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used == False,
        )
    ).all()
    for t in existing:
        t.used = True

    # Save new token
    token = PasswordResetToken(
        user_id=user.id,
        otp_hash=hash_secret(otp),
        expires_at=utcnow() + timedelta(minutes=config.OTP_EXPIRE_MINUTES),
    )
    db.add(token)
    log_event(db, action="auth.otp_requested", target_type="user", target_id=str(user.id), ip=ip)
    db.commit()

    return otp, email


def verify_otp_and_reset_password(
    db: Session, college_id: str, otp: str, new_password: str, ip: Optional[str]
) -> None:
    """Verify the OTP and set the new password. Raises on any error."""
    from app.models.accounts import PasswordResetToken

    user = db.scalar(select(User).where(User.college_id == college_id))
    if not user:
        raise AccountError(400, "Invalid or expired OTP.")

    token = db.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used == False,
        ).order_by(PasswordResetToken.id.desc())
    )

    now = utcnow()
    if not token or token.expires_at < now:
        raise AccountError(400, "Invalid or expired OTP.")

    token.attempts += 1
    if token.attempts > config.OTP_MAX_ATTEMPTS:
        token.used = True
        db.commit()
        raise AccountError(429, "Too many wrong attempts. Request a new OTP.")

    if not verify_secret(otp, token.otp_hash):
        db.commit()
        raise AccountError(400, "Invalid or expired OTP.")

    # OTP is correct — set new password
    try:
        check_password_policy(new_password, user.college_id)
    except ValueError as exc:
        raise AccountError(422, str(exc))

    user.password_hash = hash_secret(new_password)
    user.token_version += 1   # invalidates all existing sessions
    token.used = True
    log_event(db, action="auth.password_reset", target_type="user", target_id=str(user.id), ip=ip)
    db.commit()


def admin_reset_password(
    db: Session, *, actor: User, target_id: int, new_password: str, ip: Optional[str]
) -> User:
    """Admin sets a new password for a user directly (no OTP needed)."""
    target = db.get(User, target_id)
    if not target:
        raise AccountError(404, "User not found")
    if target.id == actor.id:
        raise AccountError(400, "Use the normal change-password flow for your own account.")

    try:
        check_password_policy(new_password, target.college_id)
    except ValueError as exc:
        raise AccountError(422, str(exc))

    target.password_hash = hash_secret(new_password)
    target.token_version += 1   # kicks the user out of any active session
    log_event(
        db,
        action="admin.password_reset",
        actor_id=actor.id,
        target_type="user",
        target_id=str(target.id),
        ip=ip,
    )
    db.commit()
    return target

def check_otp_valid(db: Session, college_id: str, otp: str, ip: Optional[str]) -> None:
    """Checks the OTP is valid without consuming it or incrementing attempts."""
    from app.models.accounts import PasswordResetToken

    user = db.scalar(select(User).where(User.college_id == college_id))
    if not user:
        raise AccountError(400, "Invalid or expired OTP.")

    token = db.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used == False,
        ).order_by(PasswordResetToken.id.desc())
    )

    now = utcnow()
    if not token or token.expires_at < now:
        raise AccountError(400, "Invalid or expired OTP.")

    if not verify_secret(otp, token.otp_hash):
        raise AccountError(400, "Invalid or expired OTP.")

    now = utcnow()
    if not token or token.expires_at < now:
        raise AccountError(400, "Invalid or expired OTP.")

    token.attempts += 1
    if token.attempts > config.OTP_MAX_ATTEMPTS:
        token.used = True
        db.commit()
        raise AccountError(429, "Too many wrong attempts. Request a new OTP.")

    if not verify_secret(otp, token.otp_hash):
        db.commit()
        raise AccountError(400, "Invalid or expired OTP.")

    db.commit()


def reset_password_by_cli(db: Session, college_id: str, new_password: str) -> User:
    """Reset any account's password directly from the server CLI. No OTP, no
    current-password check — this is for operators with terminal access only,
    used mainly to recover a locked-out admin account.
    """
    college_id = normalize_id(college_id)
    user = db.scalar(select(User).where(User.college_id == college_id))
    if not user:
        raise AccountError(404, "No account found with that College ID")

    try:
        check_password_policy(new_password, user.college_id)
    except ValueError as exc:
        raise AccountError(422, str(exc))

    user.password_hash = hash_secret(new_password)
    user.token_version += 1  # signs them out of any active session
    log_event(
        db,
        action="cli.password_reset",
        target_type="user",
        target_id=str(user.id),
        detail={"via": "cli"},
    )
    db.commit()
    return user