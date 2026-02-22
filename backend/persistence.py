from __future__ import annotations

import json
import secrets
from pathlib import Path

from .config import (
    DATA_DIR,
    FOLDER_INDEX_PATH,
    LIBRARIES_DIR,
    SHARE_INDEX_PATH,
    STATS_INDEX_PATH,
    _FOLDER_LOCK,
)
from .helpers import (
    default_library_user_id,
    normalize_folder_id,
    normalize_user_id,
    now_iso,
)


def load_folder_index() -> dict:
    if not FOLDER_INDEX_PATH.exists():
        return {"version": 1, "folders": {}}
    try:
        data = json.loads(FOLDER_INDEX_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"version": 1, "folders": {}}
    if not isinstance(data, dict):
        return {"version": 1, "folders": {}}
    folders = data.get("folders", {})
    if not isinstance(folders, dict):
        folders = {}
    return {"version": 1, "folders": folders}


def save_folder_index(index: dict) -> None:
    FOLDER_INDEX_PATH.write_text(json.dumps(index, indent=2), encoding="utf-8")


def user_library_dir(user_id: str) -> Path:
    normalized = normalize_user_id(user_id) or default_library_user_id()
    return LIBRARIES_DIR / normalized


def register_folder_owner(folder_id: str, user_id: str) -> None:
    normalized_folder = normalize_folder_id(folder_id)
    normalized_user = normalize_user_id(user_id) or default_library_user_id()
    if normalized_folder is None:
        return
    with _FOLDER_LOCK:
        index = load_folder_index()
        folders = index.get("folders", {})
        if not isinstance(folders, dict):
            folders = {}
        folders[normalized_folder] = {
            "userId": normalized_user,
            "updatedAt": now_iso(),
        }
        index["folders"] = folders
        save_folder_index(index)


def resolve_folder_path(
    folder_id: str,
    user_id: str | None = None,
    strict_user: bool = False,
) -> tuple[Path | None, str | None]:
    normalized_folder = normalize_folder_id(folder_id)
    if normalized_folder is None:
        return None, None

    normalized_user = normalize_user_id(user_id) if user_id else None
    if normalized_user:
        direct = user_library_dir(normalized_user) / normalized_folder
        if direct.exists():
            return direct, normalized_user
        if strict_user:
            return None, None

    with _FOLDER_LOCK:
        index = load_folder_index()
    folders = index.get("folders", {})
    owner_info = folders.get(normalized_folder) if isinstance(folders, dict) else None
    owner = None
    if isinstance(owner_info, dict):
        owner = normalize_user_id(str(owner_info.get("userId") or ""))
    if owner:
        owner_path = user_library_dir(owner) / normalized_folder
        if owner_path.exists():
            return owner_path, owner

    legacy_path = DATA_DIR / normalized_folder
    if legacy_path.exists():
        return legacy_path, "legacy"
    return None, None


def load_stats_index() -> dict:
    if not STATS_INDEX_PATH.exists():
        return {"version": 1, "users": {}}
    try:
        data = json.loads(STATS_INDEX_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"version": 1, "users": {}}
    if not isinstance(data, dict):
        return {"version": 1, "users": {}}
    users = data.get("users", {})
    if not isinstance(users, dict):
        users = {}
    return {"version": 1, "users": users}


def save_stats_index(index: dict) -> None:
    STATS_INDEX_PATH.write_text(json.dumps(index, indent=2), encoding="utf-8")


def load_share_index() -> dict:
    if not SHARE_INDEX_PATH.exists():
        return {"version": 1, "shares": {}}
    try:
        data = json.loads(SHARE_INDEX_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"version": 1, "shares": {}}
    if not isinstance(data, dict):
        return {"version": 1, "shares": {}}
    shares = data.get("shares", {})
    if not isinstance(shares, dict):
        shares = {}
    return {"version": 1, "shares": shares}


def save_share_index(index: dict) -> None:
    SHARE_INDEX_PATH.write_text(json.dumps(index, indent=2), encoding="utf-8")


def generate_share_code(existing_codes: set[str]) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(40):
        code = "".join(secrets.choice(alphabet) for _ in range(8))
        if code not in existing_codes:
            return code
    return secrets.token_hex(6).upper()
