from __future__ import annotations

import re
import threading
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SELECTION_DIR = ROOT_DIR / "selection"
SELECTION_DIR.mkdir(parents=True, exist_ok=True)
LIBRARIES_DIR = DATA_DIR / "libraries"
LIBRARIES_DIR.mkdir(parents=True, exist_ok=True)
SHARE_INDEX_PATH = DATA_DIR / "share_index.json"
STATS_INDEX_PATH = DATA_DIR / "stats_index.json"
FOLDER_INDEX_PATH = DATA_DIR / "folder_index.json"

_FOLDER_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{6,64}$")
_SELECTION_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,80}$")
_SHARE_CODE_RE = re.compile(r"^[A-Z0-9]{6,16}$")
_USER_ID_RE = re.compile(r"^[a-zA-Z0-9._:@-]{2,128}$")

_SHARE_LOCK = threading.Lock()
_STATS_LOCK = threading.Lock()
_FOLDER_LOCK = threading.Lock()

_AUDIO_FILE_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac"}
_VIDEO_FILE_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
_MEDIA_FILE_EXTS = _AUDIO_FILE_EXTS | _VIDEO_FILE_EXTS

_DIFFICULTY_MULTIPLIERS = {
    "easy": 1.0,
    "medium": 1.5,
    "high": 2.0,
}
_SCORE_DURATION_CAP_SEC = 500.0
