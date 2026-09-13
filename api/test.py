"""
api/test.py — Vercel 파일 기반 Python 함수 테스트 (stdlib only)

Next.js 자동 감지는 그대로 두고, /api/test.py 하나만 Vercel Function으로 띄운다.
- GET  /api/test   -> {"message":"python ok", ...}
- POST /api/test   -> request body를 그대로 echo
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def _send_json(self, obj: object) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        self._send_json({
            "message": "python ok",
            "runtime": "vercel-python",
            "python_version": sys.version.split()[0],
            "working_dir": os.getcwd(),
        })

    def do_POST(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {"raw": raw.decode("utf-8", errors="replace")}
        self._send_json({
            "received": body,
            "runtime": "vercel-python",
        })
