import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import ACCESS_TOKEN_MINUTES, SECRET_KEY

_ph = PasswordHasher()
_DUMMY_HASH = _ph.hash("dummy-value-for-constant-time")
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def hash_secret(value: str) -> str:
    return _ph.hash(value)


def verify_secret(value: str, hashed: Optional[str]) -> bool:
    """Always runs a hash check, even when there is nothing to compare, so timing doesn't leak what exists."""
    try:
        ok = _ph.verify(hashed or _DUMMY_HASH, value)
    except (VerificationError, InvalidHashError):
        ok = False
    return ok and hashed is not None


def new_activation_code() -> str:
    raw = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def normalize_activation_code(value: str) -> str:
    return "".join(ch for ch in value.upper() if ch.isalnum())


def check_password_policy(password: str, college_id: str) -> None:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    if college_id and college_id.lower() in password.lower():
        raise ValueError("Password must not contain your College ID")
    if len(set(password)) < 4:
        raise ValueError("Password is too repetitive")


def check_station_pin_policy(pin: str) -> None:
    if not (pin.isdigit() and 4 <= len(pin) <= 6):
        raise ValueError("Station PIN must be 4-6 digits")
    steps = {int(b) - int(a) for a, b in zip(pin, pin[1:])}
    if len(set(pin)) == 1 or steps == {1} or steps == {-1}:
        raise ValueError("Station PIN is too easy to guess")


def create_access_token(user_id: int, token_version: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    return jwt.encode({"sub": str(user_id), "tv": token_version, "exp": exp}, SECRET_KEY, algorithm="HS256")


def decode_access_token(token: str) -> Optional[Tuple[int, int]]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        return int(payload["sub"]), int(payload["tv"])
    except (jwt.PyJWTError, KeyError, ValueError, TypeError):
        return None


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def tokens_match(token: str, expected_hash: str) -> bool:
    return hmac.compare_digest(token_hash(token), expected_hash)
