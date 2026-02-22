from __future__ import annotations

import cgi
import json
import mimetypes
import secrets
import shutil
from http.server import SimpleHTTPRequestHandler
from urllib.parse import parse_qs, quote, unquote, urlparse

from .config import ROOT_DIR, _SHARE_LOCK, _STATS_LOCK
from .helpers import (
    default_library_user_id,
    normalize_difficulty,
    normalize_folder_id,
    normalize_selection_id,
    normalize_share_code,
    normalize_user_id,
    now_iso,
    sanitize_display_name,
    sanitize_name,
)
from .http_utils import send_json
from .persistence import (
    generate_share_code,
    load_share_index,
    load_stats_index,
    register_folder_owner,
    resolve_folder_path,
    save_share_index,
    save_stats_index,
    user_library_dir,
)
from .selection import (
    build_selection_index_map,
    read_selection_manifest,
    selection_detect_files,
)
from .stats_logic import (
    build_leaderboard_rows,
    clamp_score,
    compute_run_score,
    default_user_stats,
    score_to_grade,
    summarize_user_stats,
)


class LocalStorageHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def _selection_index_map(self) -> dict[str, object]:
        return build_selection_index_map()

    def _selection_file_url(self, selection_id: str, file_name: str) -> str:
        safe_file = sanitize_name(file_name)
        return f"/api/selection/file/{selection_id}/{quote(safe_file)}"

    def _selection_list_request(self) -> None:
        items: list[dict] = []
        for selection_id, selection_path in self._selection_index_map().items():
            manifest = read_selection_manifest(selection_path)
            detected = selection_detect_files(selection_path, manifest)
            routine_file = detected.get("routine")
            media_file = detected.get("audio") or detected.get("video")
            if routine_file is None or media_file is None:
                continue

            title = str(
                manifest.get("title")
                or selection_path.name.replace("_", " ").replace("-", " ").strip()
                or selection_id.replace("_", " ").replace("-", " ").title()
            )
            description = str(manifest.get("description") or "")
            category = str(manifest.get("category") or "General")
            tags_raw = manifest.get("tags")
            tags = [str(tag).strip() for tag in tags_raw if str(tag).strip()] if isinstance(tags_raw, list) else []

            duration_sec = 0.0
            try:
                duration_sec = max(0.0, float(manifest.get("durationSec") or 0.0))
            except (TypeError, ValueError):
                duration_sec = 0.0

            difficulty = normalize_difficulty(manifest.get("difficulty"), "high")
            if routine_file is not None:
                try:
                    routine_payload = json.loads(routine_file.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError):
                    routine_payload = {}
                if isinstance(routine_payload, dict):
                    difficulty = normalize_difficulty(routine_payload.get("difficulty"), difficulty)
                    if duration_sec <= 0:
                        try:
                            duration_sec = max(0.0, float(routine_payload.get("durationSec") or 0.0))
                        except (TypeError, ValueError):
                            duration_sec = 0.0

            preview_path = detected.get("preview")
            thumbnail_path = detected.get("thumbnail")
            package_path = detected.get("package")
            reference_video_path = detected.get("webcam") or detected.get("video")

            items.append(
                {
                    "id": selection_id,
                    "folderName": selection_path.name,
                    "title": title,
                    "description": description,
                    "category": category,
                    "tags": tags,
                    "durationSec": round(duration_sec, 2),
                    "difficulty": difficulty,
                    "hasWebcamVideo": bool(detected.get("webcam")),
                    "hasReferenceVideo": bool(reference_video_path),
                    "referenceVideoFileName": reference_video_path.name if reference_video_path else "",
                    "mediaFileName": media_file.name,
                    "packageZipFileName": package_path.name if package_path else "",
                    "previewUrl": self._selection_file_url(selection_id, preview_path.name) if preview_path else "",
                    "thumbnailUrl": self._selection_file_url(selection_id, thumbnail_path.name) if thumbnail_path else "",
                }
            )

        send_json(self, 200, {"ok": True, "items": items})

    def _selection_load_request(self, selection_id: str) -> None:
        normalized = normalize_selection_id(selection_id)
        if normalized is None:
            send_json(self, 404, {"ok": False, "error": "selection not found"})
            return

        selection_path = self._selection_index_map().get(normalized)
        if selection_path is None:
            send_json(self, 404, {"ok": False, "error": "selection not found"})
            return

        manifest = read_selection_manifest(selection_path)
        detected = selection_detect_files(selection_path, manifest)
        routine_file = detected.get("routine")
        media_file = detected.get("audio") or detected.get("video")

        if routine_file is None:
            send_json(self, 400, {"ok": False, "error": "selection missing routine json"})
            return
        if media_file is None:
            send_json(self, 400, {"ok": False, "error": "selection missing audio/video source"})
            return

        media_mime = mimetypes.guess_type(str(media_file))[0] or "application/octet-stream"
        package_file = detected.get("package")
        webcam_file = detected.get("webcam")
        reference_video_file = webcam_file or detected.get("video")
        webcam_layout = str(manifest.get("webcamLayout") or ("side-by-side" if reference_video_file else "raw"))

        files: dict[str, dict] = {
            "loadedRoutine": {
                "name": routine_file.name,
                "kind": "json",
                "mime": "application/json",
                "url": self._selection_file_url(normalized, routine_file.name),
            },
            "playAudioFile": {
                "name": media_file.name,
                "kind": "binary",
                "mime": media_mime,
                "url": self._selection_file_url(normalized, media_file.name),
            },
        }

        if package_file is not None:
            package_mime = mimetypes.guess_type(str(package_file))[0] or "application/zip"
            files["loadZipFile"] = {
                "name": package_file.name,
                "kind": "binary",
                "mime": package_mime,
                "url": self._selection_file_url(normalized, package_file.name),
            }

        if reference_video_file is not None:
            webcam_mime = mimetypes.guess_type(str(reference_video_file))[0] or "video/mp4"
            files["loadWebcamVideoFile"] = {
                "name": reference_video_file.name,
                "kind": "binary",
                "mime": webcam_mime,
                "url": self._selection_file_url(normalized, reference_video_file.name),
            }

        payload = {
            "ok": True,
            "folderId": normalized,
            "userId": "",
            "manifest": {
                "version": 1,
                "sessionId": "",
                "source": "selection",
                "selectionId": normalized,
                "files": files,
                "values": {
                    "recordedWebcamLayout": webcam_layout,
                },
            },
            "missingFiles": [],
        }
        send_json(self, 200, payload)

    def _selection_file_request(self, selection_id: str, file_name: str) -> None:
        normalized = normalize_selection_id(selection_id)
        if normalized is None:
            self.send_error(404)
            return

        selection_path = self._selection_index_map().get(normalized)
        if selection_path is None:
            self.send_error(404)
            return

        decoded_name = sanitize_name(unquote(file_name))
        file_path = selection_path / decoded_name
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404)
            return

        mime_type, _ = mimetypes.guess_type(str(file_path))
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _save_request(self) -> None:
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            send_json(self, 400, {"ok": False, "error": "multipart/form-data required"})
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
            },
        )

        requested_folder = normalize_folder_id(form.getfirst("folder_id"))
        request_user_id = normalize_user_id(form.getfirst("user_id")) or default_library_user_id()
        folder_id = requested_folder or secrets.token_hex(8)

        if requested_folder:
            existing_path, existing_owner = resolve_folder_path(requested_folder)
            if existing_path is not None and existing_owner not in {request_user_id, "legacy"}:
                folder_id = secrets.token_hex(8)
        else:
            while resolve_folder_path(folder_id)[0] is not None:
                folder_id = secrets.token_hex(8)

        folder_path = user_library_dir(request_user_id) / folder_id
        folder_path.mkdir(parents=True, exist_ok=True)

        manifest_raw = form.getfirst("manifest", "{}")
        try:
            manifest = json.loads(manifest_raw)
        except json.JSONDecodeError:
            send_json(self, 400, {"ok": False, "error": "invalid manifest JSON"})
            return

        if not isinstance(manifest, dict):
            send_json(self, 400, {"ok": False, "error": "manifest must be an object"})
            return

        file_meta = manifest.get("files", {})
        if not isinstance(file_meta, dict):
            file_meta = {}

        for child in folder_path.iterdir():
            if child.is_file() and child.name != "manifest.json":
                child.unlink(missing_ok=True)

        cleaned_files: dict[str, dict] = {}
        missing_upload_fields: list[str] = []

        for key, meta in file_meta.items():
            if not isinstance(meta, dict):
                continue
            field_name = f"file__{key}"
            if field_name not in form:
                missing_upload_fields.append(key)
                continue

            item = form[field_name]
            if isinstance(item, list):
                item = item[0]
            src_file = getattr(item, "file", None)
            if src_file is None:
                missing_upload_fields.append(key)
                continue

            preferred_name = sanitize_name(str(meta.get("name") or item.filename or key))
            out_path = folder_path / preferred_name
            with out_path.open("wb") as out_f:
                shutil.copyfileobj(src_file, out_f)

            cleaned = {
                "name": preferred_name,
                "kind": str(meta.get("kind") or "binary"),
                "mime": str(meta.get("mime") or "application/octet-stream"),
                "size": out_path.stat().st_size,
            }
            cleaned_files[str(key)] = cleaned

        values = manifest.get("values", {})
        if not isinstance(values, dict):
            values = {}

        persisted_manifest = {
            "version": 1,
            "sessionId": str(manifest.get("sessionId") or ""),
            "userId": request_user_id,
            "folderId": folder_id,
            "updatedAt": now_iso(),
            "files": cleaned_files,
            "values": values,
        }

        manifest_path = folder_path / "manifest.json"
        manifest_path.write_text(json.dumps(persisted_manifest, indent=2), encoding="utf-8")
        register_folder_owner(folder_id, request_user_id)

        send_json(
            self,
            200,
            {
                "ok": True,
                "folderId": folder_id,
                "manifest": persisted_manifest,
                "missingUploadFields": missing_upload_fields,
            },
        )

    def _build_storage_payload(self, folder_id: str, user_id: str | None = None, strict_user: bool = False):
        normalized = normalize_folder_id(folder_id)
        if normalized is None:
            return 404, {"ok": False, "error": "not found"}

        folder_path, owner_user_id = resolve_folder_path(normalized, user_id, strict_user=strict_user)
        if folder_path is None:
            return 404, {"ok": False, "error": "data folder missing"}
        manifest_path = folder_path / "manifest.json"
        if not folder_path.exists() or not manifest_path.exists():
            return 404, {"ok": False, "error": "data folder missing"}

        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return 500, {"ok": False, "error": "manifest corrupted"}

        files = manifest.get("files", {})
        if not isinstance(files, dict):
            files = {}

        missing_files: list[str] = []
        resolved_files: dict[str, dict] = {}
        for key, meta in files.items():
            if not isinstance(meta, dict):
                continue
            file_name = sanitize_name(str(meta.get("name") or ""))
            file_path = folder_path / file_name
            if not file_path.exists():
                missing_files.append(str(key))
                continue
            file_url = f"/api/storage/file/{normalized}/{quote(file_name)}"
            if owner_user_id and owner_user_id != "legacy":
                file_url = f"{file_url}?userId={quote(owner_user_id)}"
            resolved_files[str(key)] = {
                **meta,
                "name": file_name,
                "url": file_url,
            }

        payload = {
            "ok": True,
            "folderId": normalized,
            "userId": owner_user_id or "",
            "manifest": {
                **manifest,
                "folderId": normalized,
                "userId": owner_user_id or manifest.get("userId") or "",
                "files": resolved_files,
            },
            "missingFiles": missing_files,
        }
        return 200, payload

    def _load_request(self, folder_id: str, user_id: str | None = None) -> None:
        normalized_user = normalize_user_id(user_id) if user_id else None
        status, payload = self._build_storage_payload(folder_id, normalized_user, strict_user=bool(normalized_user))
        send_json(self, status, payload)

    def _share_create_request(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            send_json(self, 400, {"ok": False, "error": "invalid JSON"})
            return

        if not isinstance(data, dict):
            send_json(self, 400, {"ok": False, "error": "request body must be an object"})
            return

        folder_id = normalize_folder_id(str(data.get("folderId") or ""))
        if folder_id is None:
            send_json(self, 400, {"ok": False, "error": "valid folderId is required"})
            return

        request_user_id = normalize_user_id(str(data.get("userId") or ""))
        status, payload = self._build_storage_payload(folder_id, request_user_id, strict_user=bool(request_user_id))
        if status != 200:
            send_json(self, status, payload)
            return

        with _SHARE_LOCK:
            index = load_share_index()
            shares = index.get("shares", {})
            if not isinstance(shares, dict):
                shares = {}

            existing_for_folder = None
            for code, info in shares.items():
                if isinstance(info, dict) and info.get("folderId") == folder_id:
                    existing_for_folder = code
                    break

            if existing_for_folder:
                share_code = existing_for_folder
            else:
                share_code = generate_share_code(set(shares.keys()))
                shares[share_code] = {
                    "folderId": folder_id,
                    "createdAt": now_iso(),
                    "createdBy": str(data.get("sessionId") or ""),
                }

            index["shares"] = shares
            save_share_index(index)

        send_json(self, 200, {"ok": True, "code": share_code, "folderId": folder_id})

    def _share_load_request(self, code: str) -> None:
        normalized_code = normalize_share_code(code)
        if normalized_code is None:
            send_json(self, 404, {"ok": False, "error": "share code not found"})
            return

        with _SHARE_LOCK:
            index = load_share_index()
            shares = index.get("shares", {})
            info = shares.get(normalized_code) if isinstance(shares, dict) else None
            if not isinstance(info, dict):
                send_json(self, 404, {"ok": False, "error": "share code not found"})
                return
            folder_id = normalize_folder_id(str(info.get("folderId") or ""))

        if folder_id is None:
            send_json(self, 404, {"ok": False, "error": "share code not found"})
            return

        status, payload = self._build_storage_payload(folder_id, None)
        if status != 200:
            send_json(self, status, payload)
            return
        payload["sharedCode"] = normalized_code
        send_json(self, 200, payload)

    def _stats_record_request(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            send_json(self, 400, {"ok": False, "error": "invalid JSON"})
            return

        if not isinstance(data, dict):
            send_json(self, 400, {"ok": False, "error": "request body must be an object"})
            return

        user_id = normalize_user_id(str(data.get("userId") or ""))
        if user_id is None:
            send_json(self, 400, {"ok": False, "error": "valid userId is required"})
            return

        display_name = sanitize_display_name(str(data.get("displayName") or ""))
        run = data.get("run", {})
        if not isinstance(run, dict):
            send_json(self, 400, {"ok": False, "error": "run must be an object"})
            return

        average_score = clamp_score(run.get("averageScore"), 0.0)
        best_score = clamp_score(run.get("bestScore"), average_score)
        try:
            samples = max(0, int(run.get("samples") or 0))
        except (TypeError, ValueError):
            samples = 0
        try:
            duration_sec = max(0.0, float(run.get("durationSec") or 0.0))
        except (TypeError, ValueError):
            duration_sec = 0.0
        difficulty = normalize_difficulty(run.get("difficulty"), "high")
        run_score = compute_run_score(duration_sec, difficulty)
        recorded_at = now_iso()
        run_record = {
            "id": secrets.token_hex(6),
            "sessionId": str(run.get("sessionId") or ""),
            "sessionTitle": str(run.get("sessionTitle") or "Practice"),
            "averageScore": round(average_score, 2),
            "bestScore": round(best_score, 2),
            "samples": samples,
            "durationSec": round(duration_sec, 2),
            "grade": score_to_grade(average_score),
            "source": str(run.get("source") or "play"),
            "difficulty": difficulty,
            "score": run_score,
            "endedAt": recorded_at,
        }

        with _STATS_LOCK:
            index = load_stats_index()
            users = index.get("users", {})
            if not isinstance(users, dict):
                users = {}
            user = users.get(user_id) if isinstance(users.get(user_id), dict) else default_user_stats(user_id, display_name)
            user["displayName"] = display_name
            runs = user.get("runs", [])
            if not isinstance(runs, list):
                runs = []
            runs.append(run_record)
            runs = runs[-200:]
            user["runs"] = runs
            user["totalRuns"] = int(user.get("totalRuns") or 0) + 1
            user["sumAverage"] = float(user.get("sumAverage") or 0.0) + average_score
            user["bestScore"] = max(clamp_score(user.get("bestScore"), 0.0), best_score)
            user["lastRunAt"] = recorded_at
            users[user_id] = user
            index["users"] = users
            save_stats_index(index)
            summary = summarize_user_stats(user, user_id, display_name)
            leaderboard = build_leaderboard_rows(index)

        send_json(
            self,
            200,
            {
                "ok": True,
                "recordedRun": run_record,
                "userSummary": summary,
                "leaderboard": leaderboard,
            },
        )

    def _stats_summary_request(self, user_id: str) -> None:
        normalized_user_id = normalize_user_id(user_id)
        if normalized_user_id is None:
            send_json(self, 400, {"ok": False, "error": "valid userId is required"})
            return

        with _STATS_LOCK:
            index = load_stats_index()
            users = index.get("users", {})
            user = users.get(normalized_user_id) if isinstance(users, dict) else None
            if isinstance(user, dict):
                summary = summarize_user_stats(user, normalized_user_id, normalized_user_id)
            else:
                summary = {
                    "userId": normalized_user_id,
                    "displayName": normalized_user_id,
                    "runs": 0,
                    "averageScore": 0.0,
                    "bestScore": 0.0,
                    "longestDurationSec": 0.0,
                    "grade": "N/A",
                    "lastRunAt": "",
                    "recentRuns": [],
                }

        send_json(self, 200, {"ok": True, "userSummary": summary})

    def _stats_leaderboard_request(self, limit: int = 50) -> None:
        safe_limit = max(1, min(int(limit or 50), 200))
        with _STATS_LOCK:
            index = load_stats_index()
            rows = build_leaderboard_rows(index, safe_limit)
        send_json(self, 200, {"ok": True, "leaderboard": rows})

    def _file_request(self, folder_id: str, file_name: str, user_id: str | None = None) -> None:
        normalized = normalize_folder_id(folder_id)
        if normalized is None:
            self.send_error(404)
            return

        decoded_name = sanitize_name(unquote(file_name))
        normalized_user = normalize_user_id(user_id) if user_id else None
        folder_path, _ = resolve_folder_path(normalized, normalized_user, strict_user=bool(normalized_user))
        if folder_path is None:
            self.send_error(404)
            return
        file_path = folder_path / decoded_name
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404)
            return

        mime_type, _ = mimetypes.guess_type(str(file_path))
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/storage/save":
            self._save_request()
            return
        if parsed.path == "/api/share/create":
            self._share_create_request()
            return
        if parsed.path == "/api/stats/record":
            self._stats_record_request()
            return
        self.send_error(404)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            send_json(self, 200, {"ok": True, "time": now_iso()})
            return

        if parsed.path == "/api/selection/list":
            self._selection_list_request()
            return

        if parsed.path.startswith("/api/selection/load/"):
            selection_id = parsed.path.removeprefix("/api/selection/load/")
            self._selection_load_request(selection_id)
            return

        if parsed.path.startswith("/api/selection/file/"):
            remainder = parsed.path.removeprefix("/api/selection/file/")
            parts = remainder.split("/", 1)
            if len(parts) != 2:
                self.send_error(404)
                return
            self._selection_file_request(parts[0], parts[1])
            return

        if parsed.path == "/api/stats/summary":
            query = parse_qs(parsed.query or "")
            user_id = (query.get("userId") or [""])[0]
            self._stats_summary_request(user_id)
            return

        if parsed.path == "/api/stats/leaderboard":
            query = parse_qs(parsed.query or "")
            limit_raw = (query.get("limit") or ["50"])[0]
            try:
                limit = int(limit_raw)
            except ValueError:
                limit = 50
            self._stats_leaderboard_request(limit)
            return

        if parsed.path.startswith("/api/storage/load/"):
            folder_id = parsed.path.removeprefix("/api/storage/load/")
            query = parse_qs(parsed.query or "")
            user_id = (query.get("userId") or [""])[0] or None
            self._load_request(folder_id, user_id)
            return

        if parsed.path.startswith("/api/storage/file/"):
            remainder = parsed.path.removeprefix("/api/storage/file/")
            parts = remainder.split("/", 1)
            if len(parts) != 2:
                self.send_error(404)
                return
            query = parse_qs(parsed.query or "")
            user_id = (query.get("userId") or [""])[0] or None
            self._file_request(parts[0], parts[1], user_id)
            return

        if parsed.path.startswith("/api/share/load/"):
            code = parsed.path.removeprefix("/api/share/load/")
            self._share_load_request(code)
            return

        super().do_GET()
