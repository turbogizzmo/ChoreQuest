import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from backend.config import settings


_ENCRYPTED_PREFIX = "enc:"
SENSITIVE_SETTING_KEYS = {
    "vapid_private_key",
    "ai_gemini_api_key",
    "ai_openai_api_key",
    "ai_anthropic_api_key",
}


def _fernet() -> Fernet:
    key = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_secret(value: str) -> str:
    token = _fernet().encrypt(value.encode("utf-8"))
    return f"{_ENCRYPTED_PREFIX}{token.decode('ascii')}"


def decrypt_secret(value: str) -> str:
    if not value.startswith(_ENCRYPTED_PREFIX):
        return value
    token = value[len(_ENCRYPTED_PREFIX):].encode("ascii")
    try:
        return _fernet().decrypt(token).decode("utf-8")
    except InvalidToken:
        raise ValueError("Stored secret payload failed integrity validation")
