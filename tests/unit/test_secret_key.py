"""Unit tests for the auto-generated SECRET_KEY used when none is configured."""

import stat
from pathlib import Path

from backend.config import DEFAULT_DATA_DIR, load_or_create_secret_key, secret_key_path


def test_key_lives_beside_the_database():
    assert secret_key_path("sqlite+aiosqlite:////srv/cq/chores_os.db") == Path("/srv/cq/.secret_key")


def test_in_memory_database_falls_back_to_data_dir():
    assert secret_key_path("sqlite+aiosqlite:///:memory:") == DEFAULT_DATA_DIR / ".secret_key"


def test_generates_and_persists_key(tmp_path):
    path = tmp_path / "data" / ".secret_key"
    key = load_or_create_secret_key(path)
    assert len(key) == 64
    assert path.read_text().strip() == key
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_reuses_existing_key(tmp_path):
    path = tmp_path / ".secret_key"
    first = load_or_create_secret_key(path)
    assert load_or_create_secret_key(path) == first


def test_replaces_empty_key_file(tmp_path):
    path = tmp_path / ".secret_key"
    path.write_text("\n")
    key = load_or_create_secret_key(path)
    assert len(key) == 64
    assert path.read_text().strip() == key
