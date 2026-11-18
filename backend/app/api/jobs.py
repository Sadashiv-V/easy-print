from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.db import get_db
from app.models.accounts import User
from app.schemas.stations import JobOut
from app.services import jobs as svc

router = APIRouter(prefix="/jobs", tags=["jobs"])
owner_roles = require_roles("student", "staff")


@router.get("", response_model=List[JobOut])
def my_jobs(limit: int = Query(20, ge=1, le=100), user: User = Depends(owner_roles), db: Session = Depends(get_db)):
    return svc.list_jobs(db, user, limit=limit)


@router.get("/{job_id}", response_model=JobOut)
def my_job(job_id: int, user: User = Depends(owner_roles), db: Session = Depends(get_db)):
    return svc.get_job(db, user, job_id)
