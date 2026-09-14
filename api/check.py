"""
api/check.py — Vercel 파일 기반 Python 함수 (stdlib only)

POST /api/check
  요청 JSON: { "settings": "<설정집 텍스트>", "manuscript": "<원고 텍스트>" }
  처리:
    1. settings, manuscript를 각각 임시 파일로 저장
    2. skills/novel-setting-check/scripts/check_setting.py 를 subprocess로 실행
    3. stdout의 JSON을 그대로 응답
  check_setting.py는 한 글자도 수정하지 않음
"""

import json
import os
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler


def _strip_leading_whitespace(text: str) -> str:
    """설정집 각 줄의 앞쪽 공백만 제거한다 (원고 포맷은 보존)."""
    return "\n".join(line.lstrip() for line in text.splitlines())


class handler(BaseHTTPRequestHandler):
    def _send_json(self, obj: object, status: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _fail(self, message: str) -> None:
        self._send_json(
            {
                "summary": None,
                "violations": [],
                "proposed_additions": [],
                "not_checked": [],
                "errors": [message],
            },
            status=400,
        )

    def do_POST(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            self._fail("요청 본문이 JSON이 아닙니다")
            return

        settings_text = body.get("settings")
        manuscript_text = body.get("manuscript")

        if not isinstance(settings_text, str) or not settings_text.strip():
            self._fail("설정집 텍스트가 필요합니다 (settings 필드)")
            return
        if not isinstance(manuscript_text, str) or not manuscript_text.strip():
            self._fail("원고 텍스트가 필요합니다 (manuscript 필드)")
            return

        # 프로젝트 루트 기준 스크립트 경로
        script_path = os.path.join(
            os.getcwd(),
            "skills",
            "novel-setting-check",
            "scripts",
            "check_setting.py",
        )
        if not os.path.isfile(script_path):
            self._fail(f"check_setting.py를 찾을 수 없습니다: {script_path}")
            return

        # 임시 파일 생성
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", suffix=".md", delete=False
            ) as sf:
                sf.write(_strip_leading_whitespace(settings_text))
                settings_path = sf.name
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", suffix=".txt", delete=False
            ) as mf:
                mf.write(manuscript_text)
                manuscript_path = mf.name
        except OSError as e:
            self._fail(f"임시 파일 생성 실패: {e}")
            return

        try:
            proc = subprocess.run(
                [sys.executable, script_path, settings_path, manuscript_path],
                capture_output=True,
                text=True,
                timeout=120,
                encoding="utf-8",
                errors="replace",
            )
        except subprocess.TimeoutExpired:
            self._fail("check_setting.py 실행 시간 초과 (120초)")
            return
        finally:
            # 임시 파일 삭제
            for p in (settings_path, manuscript_path):
                try:
                    os.unlink(p)
                except OSError:
                    pass

        stdout = proc.stdout.strip()
        if proc.returncode != 0:
            # check_setting.py는 실패 시에도 stderr이 아니라 stdout에
            # JSON 오류 응답을 출력한다. 우선 그걸 파싱해 본다.
            if stdout:
                try:
                    result = json.loads(stdout)
                except json.JSONDecodeError:
                    result = None
                if isinstance(result, dict) and isinstance(result.get("errors"), list):
                    self._send_json(result, status=400)
                    return
            # JSON을 못 잡았으면 기존 방식으로 실패 응답
            stderr_tail = proc.stderr[-500:] if proc.stderr else ""
            self._fail(
                f"check_setting.py 실행 실패 (exit {proc.returncode}): {stderr_tail}"
            )
            return

        if not stdout:
            self._fail("check_setting.py가 출력을 생성하지 않았습니다")
            return

        # JSON 파싱 시도 — 실패 시 raw를 errors에 넣어 반환
        try:
            result = json.loads(stdout)
        except json.JSONDecodeError as e:
            self._fail(f"check_setting.py 출력이 JSON이 아닙니다: {e}. raw: {stdout[:300]}")
            return

        # 정상 응답
        self._send_json(result)
