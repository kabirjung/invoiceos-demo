"""Vercel Python serverless entry point. All /api/* requests are rewritten here (see vercel.json)."""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(__file__))
from _core import MAX_BODY, SECURITY_HEADERS, dispatch  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def _run(self):
        try:
            size = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            size = -1
        if size < 0 or size > MAX_BODY:
            status, payload = (413, {"error": "Request body must be under 100 KB", "status": 413})
            body = b""
        else:
            body = self.rfile.read(size) if size else b""
            status, payload = dispatch(self.command, self.path, self.headers, body)
        out = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(out)

    do_GET = do_POST = do_PATCH = do_PUT = do_DELETE = do_OPTIONS = _run

    def log_message(self, *_):
        pass
