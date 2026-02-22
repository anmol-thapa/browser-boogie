from __future__ import annotations

from http.server import ThreadingHTTPServer

from .handler import LocalStorageHandler


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8000), LocalStorageHandler)
    print("Serving JustDance app on http://127.0.0.1:8000")
    print("Selection API enabled at /api/selection/*")
    print("Storage API enabled at /api/storage/*")
    print("Share API enabled at /api/share/*")
    print("Stats API enabled at /api/stats/*")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
