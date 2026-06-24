import base64
import hashlib
import hmac
import secrets

from backend.config import settings


_ENCRYPTED_PREFIX = "enc:"
_NONCE_LEN = 16
_MAC_LEN = 32
SENSITIVE_SETTING_KEYS = {
    "vapid_private_key",
    "ai_gemini_api_key",
    "ai_openai_api_key",
    "ai_anthropic_api_key",
}


def _key_bytes() -> bytes:
    return hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()


def _xor_keystream(data: bytes, nonce: bytes) -> bytes:
    key = _key_bytes()
    output = bytearray()
    counter = 0
    while len(output) < len(data):
        block = hashlib.sha256(
            key + nonce + counter.to_bytes(4, "big")
        ).digest()
        output.extend(block)
        counter += 1
    return bytes(a ^ b for a, b in zip(data, output[: len(data)]))


def encrypt_secret(value: str) -> str:
    plaintext = value.encode("utf-8")
    nonce = secrets.token_bytes(_NONCE_LEN)
    ciphertext = _xor_keystream(plaintext, nonce)
    mac = hmac.new(_key_bytes(), nonce + ciphertext, hashlib.sha256).digest()
    payload = base64.urlsafe_b64encode(nonce + ciphertext + mac).decode("ascii")
    return f"{_ENCRYPTED_PREFIX}{payload}"


def decrypt_secret(value: str) -> str:
    if not value.startswith(_ENCRYPTED_PREFIX):
        return value
    raw = base64.urlsafe_b64decode(value[len(_ENCRYPTED_PREFIX):].encode("ascii"))
    if len(raw) < _NONCE_LEN + _MAC_LEN:
        raise ValueError("Stored secret payload is invalid")
    nonce = raw[:_NONCE_LEN]
    mac = raw[-_MAC_LEN:]
    ciphertext = raw[_NONCE_LEN:-_MAC_LEN]
    expected_mac = hmac.new(_key_bytes(), nonce + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(mac, expected_mac):
        raise ValueError("Stored secret payload failed integrity validation")
    plaintext = _xor_keystream(ciphertext, nonce)
    return plaintext.decode("utf-8")
