import os
import secrets
import sys
from pathlib import Path

from pydantic_settings import BaseSettings
from sqlalchemy.engine import make_url

WEAK_SECRETS = {"changeme", "secret", "password", "12345678", "1234567890123456"}

DEFAULT_DATA_DIR = Path("/app/data")


class Settings(BaseSettings):
    # Leave unset to have one generated and saved next to the database on first start
    SECRET_KEY: str = ""
    REGISTRATION_ENABLED: bool = False
    DATABASE_URL: str = "sqlite+aiosqlite:////app/data/chores_os.db"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    COOKIE_SECURE: bool = False
    LOGIN_RATE_LIMIT_MAX: int = 10
    PIN_RATE_LIMIT_MAX: int = 5
    REGISTER_RATE_LIMIT_MAX: int = 5
    CORS_ORIGINS: str = ""
    MAX_UPLOAD_SIZE_MB: int = 5
    DAILY_RESET_HOUR: int = 0
    TZ: str = "Europe/London"
    VAPID_PRIVATE_KEY: str = ""
    VAPID_PUBLIC_KEY: str = ""
    VAPID_CLAIM_EMAIL: str = "mailto:admin@example.com"
    # Set ENABLE_DEBUG_ENDPOINTS=true to expose internal /debug routes (dev only)
    ENABLE_DEBUG_ENDPOINTS: bool = False

    model_config = {"env_file": ".env", "extra": "ignore"}


def secret_key_path(database_url: str) -> Path:
    """Where a generated SECRET_KEY lives: beside the SQLite file, so a backup
    of the data folder carries the key that signs logins and encrypts secrets."""
    db_path = make_url(database_url).database
    if db_path and db_path != ":memory:":
        return Path(db_path).parent / ".secret_key"
    return DEFAULT_DATA_DIR / ".secret_key"


def load_or_create_secret_key(path: Path) -> str:
    try:
        key = path.read_text().strip()
        if key:
            return key
    except FileNotFoundError:
        pass

    key = secrets.token_hex(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        # An empty file was left behind, or another process just wrote one
        existing = path.read_text().strip()
        if existing:
            return existing
        fd = os.open(path, os.O_WRONLY | os.O_TRUNC)
    with os.fdopen(fd, "w") as f:
        f.write(key + "\n")
    print(f"Generated a new SECRET_KEY and saved it to {path}")
    return key


def get_settings() -> Settings:
    settings = Settings()
    if not settings.SECRET_KEY:
        path = secret_key_path(settings.DATABASE_URL)
        try:
            settings.SECRET_KEY = load_or_create_secret_key(path)
        except OSError as e:
            print(f"ERROR: SECRET_KEY is not set and could not be saved to {path}: {e}")
            sys.exit(1)
    if len(settings.SECRET_KEY) < 16:
        print("ERROR: SECRET_KEY must be at least 16 characters")
        sys.exit(1)
    if settings.SECRET_KEY.lower() in WEAK_SECRETS:
        print("ERROR: SECRET_KEY is a known weak value. Choose a strong secret.")
        sys.exit(1)
    return settings


settings = get_settings()
