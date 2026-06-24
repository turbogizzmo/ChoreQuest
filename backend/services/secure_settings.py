import base64
import binascii
import hashlib
import hmac
import secrets

from backend.config import settings


# New-style (XOR+HMAC) prefix.  Legacy Fernet tokens keep the old "enc:" prefix.
_ENCRYPTED_PREFIX = "enc2:"
_FERNET_PREFIX = "enc:"
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


def _decrypt_fernet_legacy(value: str) -> str:
    """Decrypt a legacy Fernet-encrypted secret (enc: prefix).

    Requires the ``cryptography`` package.  Raises ``ValueError`` if decryption
    fails or the package is not installed.
    """
    try:
        from cryptography.fernet import Fernet, InvalidToken
    except ImportError:
        raise ValueError(
            "Legacy encrypted secret (Fernet) cannot be decrypted: install the "
            "'cryptography' package or re-enter the secret so it is re-encrypted "
            "with the current scheme."
        )
    key = hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()
    fernet = Fernet(base64.urlsafe_b64encode(key))
    try:
        token = value[len(_FERNET_PREFIX):].encode("ascii")
    except (UnicodeEncodeError, ValueError) as exc:
        raise ValueError("Stored legacy secret token contains invalid characters") from exc
    try:
        return fernet.decrypt(token).decode("utf-8")
    except InvalidToken:
        raise ValueError("Stored secret payload failed integrity validation")


def encrypt_secret(value: str) -> str:
    plaintext = value.encode("utf-8")
    nonce = secrets.token_bytes(_NONCE_LEN)
    ciphertext = _xor_keystream(plaintext, nonce)
    mac = hmac.new(_key_bytes(), nonce + ciphertext, hashlib.sha256).digest()
    payload = base64.urlsafe_b64encode(nonce + ciphertext + mac).decode("ascii")
    return f"{_ENCRYPTED_PREFIX}{payload}"


def decrypt_secret(value: str) -> str:
    if value.startswith(_FERNET_PREFIX):
        return _decrypt_fernet_legacy(value)
    if not value.startswith(_ENCRYPTED_PREFIX):
        return value
    try:
        raw = base64.urlsafe_b64decode(value[len(_ENCRYPTED_PREFIX):].encode("ascii"))
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Stored secret payload is not valid base64") from exc
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
