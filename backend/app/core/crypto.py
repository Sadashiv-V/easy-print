import os

from cryptography.fernet import Fernet

from app.core.config import DATA_DIR


def _load_key() -> bytes:
    env_key = os.environ.get("EASYPRINT_STORAGE_KEY")
    if env_key:
        return env_key.encode()
    key_file = DATA_DIR / ".storage_key"
    if key_file.exists():
        return key_file.read_text().strip().encode()
    key = Fernet.generate_key()
    key_file.write_text(key.decode())
    return key


_fernet = Fernet(_load_key())


def encrypt_bytes(data: bytes) -> bytes:
    return _fernet.encrypt(data)


def decrypt_bytes(token: bytes) -> bytes:
    return _fernet.decrypt(token)
