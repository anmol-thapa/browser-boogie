from __future__ import annotations

import json
from pathlib import Path

from .config import SELECTION_DIR, _AUDIO_FILE_EXTS, _MEDIA_FILE_EXTS, _VIDEO_FILE_EXTS
from .helpers import sanitize_name, to_selection_slug


def build_selection_index_map() -> dict[str, Path]:
    index: dict[str, Path] = {}
    for child in sorted(SELECTION_DIR.iterdir(), key=lambda p: p.name.lower()):
        if not child.is_dir():
            continue
        if child.name.startswith("."):
            continue
        base_id = to_selection_slug(child.name)
        selection_id = base_id
        suffix = 2
        while selection_id in index:
            selection_id = f"{base_id}-{suffix}"
            suffix += 1
        index[selection_id] = child
    return index


def read_selection_manifest(selection_path: Path) -> dict:
    manifest_path = selection_path / "manifest.json"
    if not manifest_path.exists():
        return {}
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}
    return payload


def selection_file_by_manifest(selection_path: Path, manifest: dict, key: str) -> Path | None:
    raw = str(manifest.get(key) or "").strip()
    if not raw:
        return None
    name = sanitize_name(raw)
    file_path = selection_path / name
    if file_path.exists() and file_path.is_file():
        return file_path
    return None


def selection_detect_files(selection_path: Path, manifest: dict) -> dict:
    files = [p for p in selection_path.iterdir() if p.is_file()]
    by_name = {p.name.lower(): p for p in files}
    candidate_json = [
        p for p in files
        if p.suffix.lower() == ".json" and p.name.lower() != "manifest.json"
    ]

    routine_file = selection_file_by_manifest(selection_path, manifest, "routineFile")
    if routine_file is None:
        routine_file = by_name.get("routine.json")
    if routine_file is None and candidate_json:
        routine_file = candidate_json[0]

    audio_file = selection_file_by_manifest(selection_path, manifest, "audioFile")
    video_file = selection_file_by_manifest(selection_path, manifest, "videoFile")
    webcam_file = selection_file_by_manifest(selection_path, manifest, "webcamFile")
    package_file = (
        selection_file_by_manifest(selection_path, manifest, "packageZipFile")
        or selection_file_by_manifest(selection_path, manifest, "packageFile")
    )
    preview_file = selection_file_by_manifest(selection_path, manifest, "previewFile")
    thumbnail_file = selection_file_by_manifest(selection_path, manifest, "thumbnailFile")

    if webcam_file is None:
        webcam_file = next(
            (
                p for p in files
                if p.suffix.lower() in _VIDEO_FILE_EXTS
                and any(token in p.name.lower() for token in ("webcam", "camera", "reference", "ghost"))
            ),
            None,
        )

    if package_file is None:
        package_file = next((p for p in files if p.suffix.lower() == ".zip"), None)

    if audio_file is None:
        audio_file = next(
            (
                p for p in files
                if p.suffix.lower() in _AUDIO_FILE_EXTS
                and p != webcam_file
            ),
            None,
        )

    if video_file is None:
        video_file = next(
            (
                p for p in files
                if p.suffix.lower() in _VIDEO_FILE_EXTS
                and p != webcam_file
            ),
            None,
        )

    if audio_file is None and video_file is None:
        media_candidate = next(
            (
                p for p in files
                if p.suffix.lower() in _MEDIA_FILE_EXTS
                and p != webcam_file
            ),
            None,
        )
        if media_candidate is not None:
            if media_candidate.suffix.lower() in _AUDIO_FILE_EXTS:
                audio_file = media_candidate
            else:
                video_file = media_candidate

    if preview_file is None:
        preview_file = video_file or webcam_file

    return {
        "routine": routine_file,
        "audio": audio_file,
        "video": video_file,
        "webcam": webcam_file,
        "package": package_file,
        "preview": preview_file,
        "thumbnail": thumbnail_file,
    }
