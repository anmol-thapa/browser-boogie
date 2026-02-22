from __future__ import annotations

import re
from datetime import datetime, timezone

from .config import (
    _DIFFICULTY_MULTIPLIERS,
    _FOLDER_ID_RE,
    _SELECTION_ID_RE,
    _SHARE_CODE_RE,
    _USER_ID_RE,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sanitize_name(name: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", (name or "").strip())
    safe = safe.strip("._")
    return safe or "file.bin"


def normalize_folder_id(folder_id: str | None) -> str | None:
    value = (folder_id or "").strip()
    if not value:
        return None
    if not _FOLDER_ID_RE.fullmatch(value):
        return None
    return value


def normalize_selection_id(selection_id: str | None) -> str | None:
    value = (selection_id or "").strip()
    if not value:
        return None
    if not _SELECTION_ID_RE.fullmatch(value):
        return None
    return value


def to_selection_slug(name: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9]+", "-", str(name or "").strip().lower())
    value = re.sub(r"-{2,}", "-", value).strip("-")
    value = value[:80]
    return value or "selection"


def normalize_share_code(code: str | None) -> str | None:
    value = (code or "").strip().upper()
    if not value:
        return None
    if not _SHARE_CODE_RE.fullmatch(value):
        return None
    return value


def normalize_user_id(user_id: str | None) -> str | None:
    value = (user_id or "").strip()
    if not value:
        return None
    value = re.sub(r"\s+", "_", value)
    if not _USER_ID_RE.fullmatch(value):
        return None
    return value


def sanitize_display_name(name: str | None) -> str:
    value = re.sub(r"[\r\n\t]+", " ", str(name or "")).strip()
    if not value:
        return "Dancer"
    return value[:48]


def default_library_user_id() -> str:
    return "guest_local"


def normalize_difficulty(value: object, fallback: str = "high") -> str:
    normalized = str(value or "").strip().lower()
    if normalized in _DIFFICULTY_MULTIPLIERS:
        return normalized
    return fallback
