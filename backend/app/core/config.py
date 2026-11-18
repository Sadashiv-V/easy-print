from dotenv import load_dotenv
load_dotenv()
import os
import re
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("EASYPRINT_DATA_DIR") or BASE_DIR / "data")
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.environ.get("EASYPRINT_DATABASE_URL") or f"sqlite:///{(DATA_DIR / 'easyprint.db').as_posix()}"

# Student roll no: year(2) + college code(2) + admission type(2) + branch(2) + student code(2)
COLLEGE_CODE = os.environ.get("EASYPRINT_COLLEGE_CODE", "88")
STUDENT_ID_RE = re.compile(r"^(\d{2})(\d{2})([0-9A-Z]{2})(\d{2})([0-9A-Z]{2})$")
STAFF_ID_RE = re.compile(r"^[A-Z0-9]{4,20}$")

ACCESS_TOKEN_MINUTES = 60
MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 10
MAX_ACTIVATION_ATTEMPTS = 5
ACTIVATION_LOCK_MINUTES = 30

# Per-IP limits are generous on purpose: a whole campus can share one public IP.
LOGIN_RATE_PER_MIN = 60
REGISTER_RATE_PER_MIN = 30

# Only needed when the website and the API are on different addresses.
# Example: EASYPRINT_CORS_ORIGINS=https://print.example.edu.in
CORS_ORIGINS = [
    o.strip().rstrip("/")
    for o in os.environ.get("EASYPRINT_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]


def _load_secret_key() -> str:
    env_key = os.environ.get("EASYPRINT_SECRET")
    if env_key:
        return env_key
    key_file = DATA_DIR / ".secret_key"
    if key_file.exists():
        return key_file.read_text().strip()
    key = secrets.token_hex(32)
    key_file.write_text(key)
    return key


SECRET_KEY = _load_secret_key()

# ── Document storage (Cloudflare R2) ──────────────────────────────────────────
R2_ENDPOINT = os.environ.get("EASYPRINT_R2_ENDPOINT", "")
R2_ACCESS_KEY_ID = os.environ.get("EASYPRINT_R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.environ.get("EASYPRINT_R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.environ.get("EASYPRINT_R2_BUCKET", "easyprint-documents")

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_PAGES_PER_DOC = 200
MAX_DOCS_PER_USER = 30
MAX_TOTAL_BYTES_PER_USER = 200 * 1024 * 1024
MAX_COPIES = 100
DOCUMENT_RETENTION_DAYS = 14
PURGE_INTERVAL_SECONDS = 3600

RECHARGE_MIN_PAISE = 1000
RECHARGE_MAX_PAISE = 500000
MAX_PENDING_RECHARGES = 3
MAX_ADJUST_PAISE = 500000

STATION_IDLE_SECONDS = 120
STATION_MAX_SESSION_SECONDS = 600
STATION_LOGIN_RATE_PER_MIN = 20
STATION_SEEN_INTERVAL_SECONDS = 30
MAX_PAGES_PER_JOB = 1000
MAX_ACTIVE_JOBS_PER_USER = 3

JOB_LEASE_SECONDS = 300
QUEUE_TIMEOUT_SECONDS = 900
PRINTER_STALE_SECONDS = 90
SWEEP_INTERVAL_SECONDS = 30

# ── Email / OTP ───────────────────────────────────────────────────────────────
GMAIL_USER  = os.environ.get("EASYPRINT_GMAIL_USER", "")   # your Gmail address
GMAIL_PASS  = os.environ.get("EASYPRINT_GMAIL_PASS", "")   # Gmail App Password
OTP_EXPIRE_MINUTES = 10
OTP_MAX_ATTEMPTS   = 5