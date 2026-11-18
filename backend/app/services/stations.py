from datetime import timedelta
from typing import List, Optional, Tuple

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core import config
from app.core.db import utcnow
from app.core.errors import ServiceError
from app.core.security import new_token, token_hash, tokens_match, verify_secret
from app.models.accounts import User
from app.models.stations import Station, StationSession
from app.services.audit import log_event


def _end_sessions(db: Session, station_id: int, reason: str) -> None:
    db.execute(
        update(StationSession)
        .where(StationSession.station_id == station_id, StationSession.ended_at.is_(None))
        .values(ended_at=utcnow(), end_reason=reason)
    )


# ---- admin side ----

def create_station(db: Session, *, actor: User, name: str, location: Optional[str], ip: Optional[str]) -> Tuple[Station, str, str]:
    name = name.strip()
    if db.scalar(select(Station.id).where(func.lower(Station.name) == name.lower())):
        raise ServiceError(409, "A station with that name already exists")
    secret, agent_secret = new_token(), new_token()
    station = Station(
        name=name, location=location, key_hash=token_hash(secret), agent_key_hash=token_hash(agent_secret),
        status="active", created_at=utcnow(),
    )
    db.add(station)
    db.flush()
    log_event(db, action="station.create", actor_id=actor.id, target_type="station", target_id=str(station.id), ip=ip, detail={"name": name})
    db.commit()
    return station, f"{station.id}.{secret}", f"{station.id}.{agent_secret}"


def _get_station(db: Session, station_id: int) -> Station:
    station = db.get(Station, station_id)
    if not station:
        raise ServiceError(404, "Station not found")
    return station


def set_station_active(db: Session, *, actor: User, station_id: int, active: bool, reason: str, ip: Optional[str]) -> Station:
    station = _get_station(db, station_id)
    station.status = "active" if active else "inactive"
    if not active:
        _end_sessions(db, station.id, "disabled")
    log_event(
        db, action="station.activate" if active else "station.deactivate", actor_id=actor.id,
        target_type="station", target_id=str(station.id), reason=reason, ip=ip,
    )
    db.commit()
    return station


def rotate_key(db: Session, *, actor: User, station_id: int, reason: str, ip: Optional[str]) -> Tuple[Station, str]:
    station = _get_station(db, station_id)
    secret = new_token()
    station.key_hash = token_hash(secret)
    _end_sessions(db, station.id, "key_rotated")
    log_event(db, action="station.rotate_key", actor_id=actor.id, target_type="station", target_id=str(station.id), reason=reason, ip=ip)
    db.commit()
    return station, f"{station.id}.{secret}"


def rotate_agent_key(db: Session, *, actor: User, station_id: int, reason: str, ip: Optional[str]) -> str:
    station = _get_station(db, station_id)
    secret = new_token()
    station.agent_key_hash = token_hash(secret)
    log_event(db, action="station.rotate_agent_key", actor_id=actor.id, target_type="station", target_id=str(station.id), reason=reason, ip=ip)
    db.commit()
    return f"{station.id}.{secret}"


def printer_available(station: Station) -> bool:
    """Unknown (no agent has ever reported) counts as available so setups without an agent keep working."""
    if station.printer_status == "unknown":
        return True
    if station.printer_status != "online" or station.printer_status_at is None:
        return False
    return (utcnow() - station.printer_status_at).total_seconds() <= config.PRINTER_STALE_SECONDS


def station_dict(station: Station, in_use: bool = False) -> dict:
    return {
        "id": station.id, "name": station.name, "location": station.location, "status": station.status,
        "last_seen_at": station.last_seen_at, "created_at": station.created_at, "in_use": in_use,
        "printer_status": station.printer_status, "printer_message": station.printer_message,
        "printer_status_at": station.printer_status_at, "printer_ok": printer_available(station),
        "agent_configured": station.agent_key_hash is not None,
    }


def list_stations(db: Session) -> List[dict]:
    now = utcnow()
    in_use = {
        sid
        for sid in db.scalars(
            select(StationSession.station_id).where(StationSession.ended_at.is_(None), StationSession.expires_at > now)
        )
    }
    return [station_dict(s, s.id in in_use) for s in db.scalars(select(Station).order_by(Station.id))]


# ---- kiosk side ----

def authenticate_station(db: Session, raw_key: Optional[str]) -> Station:
    sid, _, secret = (raw_key or "").partition(".")
    station = db.get(Station, int(sid)) if sid.isdigit() else None
    if not station or not secret or not tokens_match(secret, station.key_hash):
        raise ServiceError(401, "Invalid station key")
    if station.status != "active":
        raise ServiceError(403, "This station is disabled")
    now = utcnow()
    if station.last_seen_at is None or (now - station.last_seen_at).total_seconds() > config.STATION_SEEN_INTERVAL_SECONDS:
        station.last_seen_at = now
        db.commit()
    return station


def authenticate_agent(db: Session, raw_key: Optional[str]) -> Station:
    sid, _, secret = (raw_key or "").partition(".")
    station = db.get(Station, int(sid)) if sid.isdigit() else None
    if not station or not secret or not station.agent_key_hash or not tokens_match(secret, station.agent_key_hash):
        raise ServiceError(401, "Invalid agent key")
    if station.status != "active":
        raise ServiceError(403, "This station is disabled")
    return station


def station_login(db: Session, station: Station, college_id: str, pin: str, ip: Optional[str]) -> Tuple[str, StationSession, User]:
    user = db.scalar(select(User).where(User.college_id == college_id, User.role.in_(("student", "staff"))))
    now = utcnow()

    if user and user.pin_locked_until and user.pin_locked_until > now:
        raise ServiceError(429, "Too many wrong PINs. Try again later.")

    if not verify_secret(pin, user.station_pin_hash if user else None):
        if user:
            user.pin_failed_attempts += 1
            if user.pin_failed_attempts >= config.MAX_FAILED_LOGINS:
                user.pin_locked_until = now + timedelta(minutes=config.LOCKOUT_MINUTES)
                user.pin_failed_attempts = 0
                log_event(db, action="station.pin_lockout", target_type="user", target_id=str(user.id), ip=ip, detail={"station_id": station.id})
            db.commit()
        raise ServiceError(401, "Incorrect College ID or PIN")

    if user.status != "active":
        raise ServiceError(403, "This account is blocked. Please contact the administrator.")

    user.pin_failed_attempts = 0
    user.pin_locked_until = None
    _end_sessions(db, station.id, "replaced")
    token = new_token()
    session = StationSession(
        station_id=station.id,
        user_id=user.id,
        token_hash=token_hash(token),
        created_at=now,
        last_activity_at=now,
        expires_at=now + timedelta(seconds=config.STATION_MAX_SESSION_SECONDS),
    )
    db.add(session)
    db.commit()
    return token, session, user


def authenticate_session(db: Session, station: Station, raw_token: Optional[str]) -> Tuple[StationSession, User]:
    if not raw_token:
        raise ServiceError(401, "Station session required. Log in first.")
    session = db.scalar(select(StationSession).where(StationSession.token_hash == token_hash(raw_token)))
    if not session or session.station_id != station.id or session.ended_at is not None:
        raise ServiceError(401, "Station session is not valid")

    now = utcnow()
    idle = (now - session.last_activity_at).total_seconds()
    user = db.get(User, session.user_id)
    if now > session.expires_at or idle > config.STATION_IDLE_SECONDS or not user or user.status != "active":
        session.ended_at = now
        session.end_reason = "expired"
        db.commit()
        raise ServiceError(401, "Station session expired. Please log in again.")

    session.last_activity_at = now
    db.commit()
    return session, user


def end_session(db: Session, session: StationSession, reason: str = "logout") -> None:
    session.ended_at = utcnow()
    session.end_reason = reason
    db.commit()
