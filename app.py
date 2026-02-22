from __future__ import annotations

import cgi
import json
import mimetypes
import re
import secrets
import shutil
import threading
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
LIBRARIES_DIR = DATA_DIR / "libraries"
LIBRARIES_DIR.mkdir(parents=True, exist_ok=True)
SHARE_INDEX_PATH = DATA_DIR / "share_index.json"
STATS_INDEX_PATH = DATA_DIR / "stats_index.json"
FOLDER_INDEX_PATH = DATA_DIR / "folder_index.json"

_FOLDER_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{6,64}$")
_SHARE_CODE_RE = re.compile(r"^[A-Z0-9]{6,16}$")
_USER_ID_RE = re.compile(r"^[a-zA-Z0-9._:@-]{2,128}$")
_SHARE_LOCK = threading.Lock()
_STATS_LOCK = threading.Lock()
_FOLDER_LOCK = threading.Lock()


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


def clamp_score(value: object, default: float = 0.0) -> float:
    try:
        score = float(value)
    except (TypeError, ValueError):
        score = default
    return max(0.0, min(100.0, score))


def score_to_grade(score: float) -> str:
    s = clamp_score(score)
    if s >= 95:
        return "A+"
    if s >= 90:
        return "A"
    if s >= 85:
        return "B+"
    if s >= 80:
        return "B"
    if s >= 75:
        return "C+"
    if s >= 70:
        return "C"
    if s >= 65:
        return "D"
    return "F"


def default_user_stats(user_id: str, display_name: str) -> dict:
    return {
        "userId": user_id,
        "displayName": display_name,
        "runs": [],
        "totalRuns": 0,
        "sumAverage": 0.0,
        "bestScore": 0.0,
        "lastRunAt": "",
    }


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


def summarize_user_stats(user: dict, fallback_user_id: str, fallback_display: str) -> dict:
    runs = user.get("runs", [])
    if not isinstance(runs, list):
        runs = []
    total_runs = int(user.get("totalRuns") or len(runs))
    sum_average = float(user.get("sumAverage") or 0.0)
    average_score = (sum_average / total_runs) if total_runs > 0 else 0.0
    best_score = clamp_score(user.get("bestScore"), 0.0)
    display_name = sanitize_display_name(user.get("displayName") or fallback_display)
    user_id = str(user.get("userId") or fallback_user_id)
    recent = [entry for entry in runs if isinstance(entry, dict)][-5:]
    recent.reverse()
    grade = score_to_grade(average_score) if total_runs > 0 else "N/A"
    return {
        "userId": user_id,
        "displayName": display_name,
        "runs": total_runs,
        "averageScore": round(average_score, 2),
        "bestScore": round(best_score, 2),
        "grade": grade,
        "lastRunAt": str(user.get("lastRunAt") or ""),
        "recentRuns": recent,
    }


def build_leaderboard_rows(index: dict, limit: int = 50) -> list[dict]:
    users = index.get("users", {})
    if not isinstance(users, dict):
        return []
    rows: list[dict] = []
    for user_id, raw_user in users.items():
        if not isinstance(raw_user, dict):
            continue
        summary = summarize_user_stats(raw_user, str(user_id), str(user_id))
        if summary["runs"] <= 0:
            continue
        rows.append(summary)
    rows.sort(
        key=lambda row: (
            -float(row.get("averageScore") or 0),
            -float(row.get("bestScore") or 0),
            -int(row.get("runs") or 0),
            str(row.get("displayName") or "").lower(),
        )
    )
    for idx, row in enumerate(rows, start=1):
        row["rank"] = idx
    return rows[: max(1, min(limit, 200))]


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


def send_json(handler: SimpleHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class LocalStorageHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

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
                # Avoid cross-user overwrites when a folder id from a different user is submitted.
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

        # Keep folder contents aligned with current manifest payload.
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
        samples = max(0, int(run.get("samples") or 0))
        duration_sec = max(0.0, float(run.get("durationSec") or 0.0))
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


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8000), LocalStorageHandler)
    print("Serving JustDance app on http://127.0.0.1:8000")
    print("Storage API enabled at /api/storage/*")
    print("Share API enabled at /api/share/*")
    print("Stats API enabled at /api/stats/*")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
