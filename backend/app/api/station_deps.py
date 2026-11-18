from typing import NamedTuple, Optional

from fastapi import Depends
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.accounts import User
from app.models.stations import Station, StationSession
from app.services import stations as svc

station_key_header = APIKeyHeader(name="X-Station-Key", scheme_name="StationKey", auto_error=False)
station_session_header = APIKeyHeader(name="X-Station-Session", scheme_name="StationSession", auto_error=False)


class StationContext(NamedTuple):
    station: Station
    session: StationSession
    user: User


def get_station(raw_key: Optional[str] = Depends(station_key_header), db: Session = Depends(get_db)) -> Station:
    return svc.authenticate_station(db, raw_key)


def get_station_context(
    station: Station = Depends(get_station),
    raw_token: Optional[str] = Depends(station_session_header),
    db: Session = Depends(get_db),
) -> StationContext:
    session, user = svc.authenticate_session(db, station, raw_token)
    return StationContext(station, session, user)


def station_login_key(request) -> str:
    """Rate-limit bucket: the station id from the key header (or the client address if absent)."""
    raw = request.headers.get("x-station-key", "")
    sid = raw.partition(".")[0]
    return f"station:{sid}" if sid.isdigit() else f"ip:{request.client.host if request.client else 'unknown'}"
