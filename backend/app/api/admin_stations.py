from typing import List, Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.db import get_db
from app.models.accounts import User
from app.schemas.stations import AgentKeyOut, ReasonRequest, StationCreate, StationOut, StationWithKeyOut
from app.services import stations as svc

router = APIRouter(prefix="/admin/stations", tags=["admin-stations"])
admin_only = require_roles("admin")


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _with_key(station, key: str, agent_key: Optional[str] = None) -> dict:
    return {**svc.station_dict(station), "station_key": key, "agent_key": agent_key}


@router.post("", response_model=StationWithKeyOut, status_code=201)
def create_station(body: StationCreate, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    station, key, agent_key = svc.create_station(db, actor=admin, name=body.name, location=body.location, ip=_ip(request))
    return _with_key(station, key, agent_key)


@router.get("", response_model=List[StationOut])
def list_stations(_admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    return svc.list_stations(db)


@router.post("/{station_id}/deactivate", response_model=StationOut)
def deactivate(station_id: int, body: ReasonRequest, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    svc.set_station_active(db, actor=admin, station_id=station_id, active=False, reason=body.reason, ip=_ip(request))
    return next(s for s in svc.list_stations(db) if s["id"] == station_id)


@router.post("/{station_id}/activate", response_model=StationOut)
def activate(station_id: int, body: ReasonRequest, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    svc.set_station_active(db, actor=admin, station_id=station_id, active=True, reason=body.reason, ip=_ip(request))
    return next(s for s in svc.list_stations(db) if s["id"] == station_id)


@router.post("/{station_id}/rotate-key", response_model=StationWithKeyOut)
def rotate_key(station_id: int, body: ReasonRequest, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    station, key = svc.rotate_key(db, actor=admin, station_id=station_id, reason=body.reason, ip=_ip(request))
    return _with_key(station, key)


@router.post("/{station_id}/rotate-agent-key", response_model=AgentKeyOut)
def rotate_agent_key(station_id: int, body: ReasonRequest, request: Request, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    key = svc.rotate_agent_key(db, actor=admin, station_id=station_id, reason=body.reason, ip=_ip(request))
    return {"id": station_id, "agent_key": key}
