from typing import Optional

from fastapi import APIRouter, Depends, Response
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.stations import Station
from app.schemas.agent import AgentItem, AgentJob, ItemResult, PrinterStatusIn
from app.services import agent as svc
from app.services import stations as station_svc

router = APIRouter(prefix="/agent", tags=["agent"])
agent_key_header = APIKeyHeader(name="X-Agent-Key", scheme_name="AgentKey", auto_error=False)


def get_agent_station(raw_key: Optional[str] = Depends(agent_key_header), db: Session = Depends(get_db)) -> Station:
    return station_svc.authenticate_agent(db, raw_key)


def _job_out(db: Session, job) -> AgentJob:
    return AgentJob(id=job.id, items=[AgentItem.model_validate(i, from_attributes=True) for i in svc.job_items(db, job)])


@router.post("/claim", response_model=AgentJob, responses={204: {"description": "Nothing to print"}})
def claim(station: Station = Depends(get_agent_station), db: Session = Depends(get_db)):
    job = svc.claim_next(db, station)
    if job is None:
        return Response(status_code=204)
    return _job_out(db, job)


@router.get("/jobs/{job_id}/items/{item_id}/file", response_class=Response, responses={200: {"content": {"application/pdf": {}}}})
def download_file(job_id: int, item_id: int, station: Station = Depends(get_agent_station), db: Session = Depends(get_db)):
    data = svc.item_file(db, station, job_id, item_id)
    return Response(content=data, media_type="application/pdf", headers={"Cache-Control": "no-store"})


@router.post("/jobs/{job_id}/items/{item_id}/result", response_model=AgentJob)
def report_result(
    job_id: int, item_id: int, body: ItemResult, station: Station = Depends(get_agent_station), db: Session = Depends(get_db)
):
    return _job_out(db, svc.report_item(db, station, job_id, item_id, body.status, body.reason))


@router.post("/printer-status", status_code=204)
def printer_status(body: PrinterStatusIn, station: Station = Depends(get_agent_station), db: Session = Depends(get_db)):
    svc.set_printer_status(db, station, body.status, body.message)
    return Response(status_code=204)
