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
from urllib.parse import quote, unquote, urlparse

ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SHARE_INDEX_PATH = DATA_DIR / "share_index.json"

_FOLDER_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{6,64}$")
_SHARE_CODE_RE = re.compile(r"^[A-Z0-9]{6,16}$")
_SHARE_LOCK = threading.Lock()


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
        folder_id = requested_folder or secrets.token_hex(8)
        folder_path = DATA_DIR / folder_id
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
            "folderId": folder_id,
            "updatedAt": now_iso(),
            "files": cleaned_files,
            "values": values,
        }

        manifest_path = folder_path / "manifest.json"
        manifest_path.write_text(json.dumps(persisted_manifest, indent=2), encoding="utf-8")

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

    def _build_storage_payload(self, folder_id: str):
        normalized = normalize_folder_id(folder_id)
        if normalized is None:
            return 404, {"ok": False, "error": "not found"}

        folder_path = DATA_DIR / normalized
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
            resolved_files[str(key)] = {
                **meta,
                "name": file_name,
                "url": f"/api/storage/file/{normalized}/{quote(file_name)}",
            }

        payload = {
            "ok": True,
            "folderId": normalized,
            "manifest": {
                **manifest,
                "folderId": normalized,
                "files": resolved_files,
            },
            "missingFiles": missing_files,
        }
        return 200, payload

    def _load_request(self, folder_id: str) -> None:
        status, payload = self._build_storage_payload(folder_id)
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

        status, payload = self._build_storage_payload(folder_id)
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

        status, payload = self._build_storage_payload(folder_id)
        if status != 200:
            send_json(self, status, payload)
            return
        payload["sharedCode"] = normalized_code
        send_json(self, 200, payload)

    def _file_request(self, folder_id: str, file_name: str) -> None:
        normalized = normalize_folder_id(folder_id)
        if normalized is None:
            self.send_error(404)
            return

        decoded_name = sanitize_name(unquote(file_name))
        file_path = DATA_DIR / normalized / decoded_name
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
        self.send_error(404)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            send_json(self, 200, {"ok": True, "time": now_iso()})
            return

        if parsed.path.startswith("/api/storage/load/"):
            folder_id = parsed.path.removeprefix("/api/storage/load/")
            self._load_request(folder_id)
            return

        if parsed.path.startswith("/api/storage/file/"):
            remainder = parsed.path.removeprefix("/api/storage/file/")
            parts = remainder.split("/", 1)
            if len(parts) != 2:
                self.send_error(404)
                return
            self._file_request(parts[0], parts[1])
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
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
