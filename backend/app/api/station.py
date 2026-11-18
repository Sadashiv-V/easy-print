from typing import List, Optional

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.station_deps import StationContext, get_station, get_station_context, station_login_key
from app.core import config
from app.core.db import get_db
from app.core.ratelimit import RateLimiter
from app.models.stations import Station
from app.schemas.documents import DocumentOut
from app.schemas.stations import (
    JobOut,
    PrinterStateOut,
    PrintRequest,
    QuoteOut,
    QuoteRequest,
    StationLoginOut,
    StationLoginRequest,
    StationUserOut,
)
from app.services import documents as doc_svc
from app.services import jobs as job_svc
from app.services import stations as station_svc
from app.services.pricing import current_rule
from app.services.wallet import summary

router = APIRouter(prefix="/station", tags=["station"])

login_limiter = RateLimiter(config.STATION_LOGIN_RATE_PER_MIN, 60, key_func=station_login_key)


def _user_out(db: Session, ctx_user, session) -> dict:
    return {
        "college_id": ctx_user.college_id,
        "full_name": ctx_user.full_name,
        **summary(db, ctx_user.id),
        "session_expires_at": session.expires_at,
        "idle_timeout_seconds": config.STATION_IDLE_SECONDS,
    }


@router.get("/status", response_model=PrinterStateOut)
def printer_state(station: Station = Depends(get_station)):
    ok = station_svc.printer_available(station)
    return {
        "printer_available": ok,
        "printer_status": station.printer_status,
        "message": None if ok else (station.printer_message or "Printer is not available right now"),
    }


@router.post("/login", response_model=StationLoginOut, dependencies=[Depends(login_limiter)])
def login(
    body: StationLoginRequest,
    request: Request,
    station: Station = Depends(get_station),
    db: Session = Depends(get_db),
):
    ip: Optional[str] = request.client.host if request.client else None
    token, session, user = station_svc.station_login(db, station, body.college_id, body.pin, ip)
    return {**_user_out(db, user, session), "session_token": token}


@router.get("/me", response_model=StationUserOut)
def me(ctx: StationContext = Depends(get_station_context), db: Session = Depends(get_db)):
    return _user_out(db, ctx.user, ctx.session)


@router.post("/logout", status_code=204)
def logout(ctx: StationContext = Depends(get_station_context), db: Session = Depends(get_db)):
    station_svc.end_session(db, ctx.session)
    return Response(status_code=204)


@router.get("/documents", response_model=List[DocumentOut])
def my_documents(ctx: StationContext = Depends(get_station_context), db: Session = Depends(get_db)):
    rule = current_rule(db)
    return [doc_svc.to_out(d, rule) for d in doc_svc.list_documents(db, ctx.user)]


@router.post("/quote", response_model=QuoteOut)
def quote(body: QuoteRequest, ctx: StationContext = Depends(get_station_context), db: Session = Depends(get_db)):
    return job_svc.quote(db, ctx.user, body.items)


@router.post("/print", response_model=JobOut, status_code=201)
def print_documents(body: PrintRequest, ctx: StationContext = Depends(get_station_context), db: Session = Depends(get_db)):
    return job_svc.create_job(
        db, user=ctx.user, station=ctx.station, session=ctx.session,
        items=body.items, idempotency_key=body.idempotency_key,
    )


@router.get("/jobs", response_model=List[JobOut])
def my_jobs_here(ctx: StationContext = Depends(get_station_context), db: Session = Depends(get_db)):
    return job_svc.list_jobs(db, ctx.user, station_id=ctx.station.id)


@router.post("/jobs/{job_id}/cancel", response_model=JobOut)
def cancel_job(job_id: int, ctx: StationContext = Depends(get_station_context), db: Session = Depends(get_db)):
    return job_svc.cancel_job(db, ctx.user, job_id)
