#!/usr/bin/env python3
"""Local dev server: serves index.html/app.js and routes /api/* through api/_core.py.

Uses a local SQLite file (invoiceos.sqlite3, created and seeded on first run) unless
SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. On Vercel the same core runs from api/index.py.
"""
import errno
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "api"))
from _core import MAX_BODY, SECURITY_HEADERS, dispatch  # noqa: E402

STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/demo": ("index.html", "text/html; charset=utf-8"),
    "/demo/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    timeout = 15

    def _send(self, status, body, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _run(self):
        path = self.path.split("?", 1)[0]
        if self.command in ("GET", "HEAD") and path in STATIC:
            name, ctype = STATIC[path]
            return self._send(200, (ROOT / name).read_bytes(), ctype, {"Cache-Control": "no-cache"})
        if not path.startswith("/api/"):
            return self._send(404, b'{"error":"Not found"}', "application/json")
        try:
            size = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            size = -1
        if size < 0 or size > MAX_BODY:
            status, payload = 413, {"error": "Request body must be under 100 KB", "status": 413}
        else:
            body = self.rfile.read(size) if size else b""
            status, payload = dispatch(self.command, self.path, self.headers, body)
        out = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self._send(status, out, SECURITY_HEADERS["Content-Type"],
                   {k: v for k, v in SECURITY_HEADERS.items() if k != "Content-Type"})

    do_GET = do_HEAD = do_POST = do_PATCH = do_PUT = do_DELETE = do_OPTIONS = _run

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        print("Using Supabase")
    else:
        os.environ["INVOICEOS_LOCAL"] = "1"
        print("Using local SQLite database (invoiceos.sqlite3)")
    preferred = int(os.environ.get("INVOICEOS_PORT", "8765"))
    for port in range(preferred, preferred + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError as e:
            if e.errno != errno.EADDRINUSE:
                raise
    else:
        raise SystemExit("No free local port found")
    print(f"InvoiceOS running at http://127.0.0.1:{port}")
    server.serve_forever()
