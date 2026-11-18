import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import admin, admin_stations, admin_wallet, agent, auth, documents, jobs, station, wallet
from app.core.config import CORS_ORIGINS, PURGE_INTERVAL_SECONDS, SWEEP_INTERVAL_SECONDS
from app.core.db import SessionLocal
from app.core.errors import ServiceError
from app.core.migrate import run_migrations
from app.services.agent import sweep
from app.services.documents import purge_expired

log = logging.getLogger("easyprint")


def _purge_once() -> None:
    with SessionLocal() as db:
        purge_expired(db)


def _sweep_once() -> None:
    with SessionLocal() as db:
        sweep(db)


async def _loop(job, interval: int, label: str) -> None:
    while True:
        try:
            await asyncio.to_thread(job)
        except Exception:
            log.exception("%s failed", label)
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    run_migrations()
    tasks = [
        asyncio.create_task(_loop(_purge_once, PURGE_INTERVAL_SECONDS, "Expired-document cleanup")),
        asyncio.create_task(_loop(_sweep_once, SWEEP_INTERVAL_SECONDS, "Print-queue sweep")),
    ]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="Easy-Print API", version="0.6.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(ServiceError)
async def service_error_handler(_request: Request, exc: ServiceError):
    return JSONResponse(status_code=exc.status, content={"detail": exc.detail})


app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(wallet.router)
app.include_router(admin.router)
app.include_router(admin_wallet.router)
app.include_router(admin_stations.router)
app.include_router(station.router)
app.include_router(agent.router)
app.include_router(jobs.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}
