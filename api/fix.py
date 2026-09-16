"""
api/fix.py — Vercel 파일 기반 Python 함수 (stdlib only)

POST /api/fix
  요청 JSON:
  {
    "settings_text": "...",
    "manuscript_text": "...",
    "confirmed_items": [
      { "type": "...", "subject": "...", "detail": "...", "line": ..., "evidence": "...", "context": "..." }
    ]
  }
  처리:
    1. 설정집 + 원고 + 확정 항목을 Solar(solar-pro4)에 넘겨,
       확정된 충돌만 고친 원고 전체와 changes를 생성하게 한다.
    2. Solar 응답을 JSON으로 파싱한다 (markdown fence 제거 포함).
    3. revised_manuscript가 원고 대비 지나치게 짧으면 오류로 처리한다.
    4. revised_manuscript와 changes를 반환한다.
  conflicts.py의 Solar 호출/응답 헬퍼 패턴을 재사용하되, 본 파일에 직접 넣는다.
"""
import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

API_URL = "https://api.upstage.ai/v1/chat/completions"
MODEL = "solar-pro4"

# ─────────────────────── 응답 헬퍼 ───────────────────────

def _send_json(handler, obj, status=200):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)

def _fail(handler, message, status=400, confirmed_count=0):
    _send_json(
        handler,
        {
            "revised_manuscript": None,
            "summary": {
                "confirmed_count": confirmed_count,
                "revised_length": 0,
                "original_length": 0,
            },
            "changes": [],
            "errors": [message],
        },
        status=status,
    )

def _dump_raw_content(content, exc):
    """파싱 실패 디버깅용: raw content 앞부분을 stderr로 남긴다."""
    head = content[:2000]
    msg = (
        f"--- RAW CONTENT (앞 2000자, 파싱실패: {exc}) ---\n"
        f"{head}\n"
        f"--- END ---"
    )
    print(msg, file=__import__("sys").stderr)

# ─────────────────────── Solar 호출 ───────────────────────

def _call_solar(api_key, prompt_text):
    payload = {
        "model": MODEL,
        "messages": [
            {
                "role": "system",
                "content": "You output only a valid JSON object. No other text, no markdown.",
            },
            {"role": "user", "content": prompt_text},
        ],
        "max_tokens": 16000,
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
    }
    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=req_data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw)

# ─────────────────────── 프롬프트 빌드 ───────────────────────

def _build_fix_prompt(settings_text, manuscript_text, confirmed_items):
    """설정집 + 원고 + 확정 항목을 받아, Solar가 원고를 고치도록 지시하는 프롬프트.

    출력 JSON은 반드시 다음 구조로 한정한다:
      {
        "revised_manuscript": "...",
        "changes": [
          { "item_index": 0, "subject": "...", "change_description": "...",
            "original_snippet": "...", "revised_snippet": "..." }
        ]
      }
    """
    lines = []
    lines.append(
        "이 서비스는 웹소설 설정집과 회차 원고를 비교해 설정 충돌을 찾는 도구다."
    )
    lines.append("")
    lines.append(
        "아래에 (1) 설정집, (2) 회차 원고 전체, (3) 사용자가 확정한 충돌 목록을 준다."
    )
    lines.append("")
    lines.append(
        "당신은 설정집을 기준으로, 확정된 충돌 항목들만 원고에서 고쳐서 원고 전체를 다시 써야 한다."
    )
    lines.append("")
    lines.append(
        "확정된 충돌 외의 부분은 가능한 한 원본 그대로 유지하라. "
        "문체, 대사, 구성, 다른 표현은 건드리지 마라. 설정집의 정보에 맞춰 충돌 표현만 수정하라."
    )
    lines.append(
        "능력·제약 충돌(ability_candidate)은 설정집에서 불가로 지정된 행위나 표현을 "
        "원고에서 제거하거나 다른 표현으로 바꿔라. 불가 항목을 그대로 둔 채 문장만 옮기지 마라."
    )
    lines.append("")
    lines.append(
        "고친 결과는 원고 전체여야 한다. 일부만 반환하지 마라."
    )
    lines.append("")
    lines.append("출력 JSON 구조 (하나만 출력):")
    lines.append(
        '  {'
        '"revised_manuscript": "고친 원고 전체",'
        '"changes": ['
        '{'
        '"item_index": 0,'
        '"subject": "충돌 대상의 짧은 이름",'
        '"change_description": "어떻게 고쳤는지 한 줄",'
        '"original_snippet": "원본 원고에서 해당 부분의 짧은 발췌(최대 120자)",'
        '"revised_snippet": "고친 원고에서 해당 부분의 짧은 발췌(최대 120자)"'
        '}'
        ']'
        '}'
    )
    lines.append("")
    lines.append(
        "각 변경 항목은 확정된 항목 순서대로 item_index를 0부터 부여한다."
    )
    lines.append(
        "original_snippet과 revised_snippet은 실제 바뀐 표현 근방의 짧은 문장/구절만 담는다. "
        "최대 120자까지 사용하고, 넘으면 자르고 말줄임표(...)를 붙인다."
    )
    lines.append("")
    lines.append("─── (1) 설정집 ───")
    lines.append(settings_text)
    lines.append("")
    lines.append("─── (2) 회차 원고 전체 ───")
    lines.append(manuscript_text)
    lines.append("")
    lines.append("─── (3) 사용자가 확정한 충돌 목록 ───")
    lines.append(_confirmed_items_summary(confirmed_items))
    lines.append("")
    lines.append(
        "위 (3)의 충돌들을 해결하도록 원고를 고치고, 위 JSON 구조로 출력하라."
    )
    return "\n".join(lines)

def _confirmed_items_summary(confirmed_items):
    """확정 항목을 Solar가 읽기 쉬운 요약 문자열로 만든다."""
    if not isinstance(confirmed_items, list) or not confirmed_items:
        return "확정된 충돌 항목이 없습니다."
    parts = []
    for i, item in enumerate(confirmed_items):
        if not isinstance(item, dict):
            continue
        subject = item.get("subject") or "?"
        detail = item.get("detail") or ""
        evidence = item.get("evidence") or ""
        idx = f"[{i}]" if i is not None else ""
        if detail:
            parts.append(f"{idx} [{item.get('type') or '?'}] {subject}: {detail}")
        else:
            parts.append(f"{idx} [{item.get('type') or '?'}] {subject}")
        if evidence:
            ev_short = evidence[:120]
            if len(evidence) > 120:
                ev_short += "..."
            parts.append(f"    근거: {ev_short}")
    if not parts:
        return "확정된 충돌 항목이 없습니다."
    return "\n".join(parts)

# ─────────────────────── 응답 파싱 ───────────────────────

def _parse_fix_response(raw_resp):
    """Solar 응답을 파싱해 revised_manuscript와 changes를 추출한다.

    실패 시 (None, None, error_message) 반환.
    """
    choices = raw_resp.get("choices", [])
    if not choices:
        return None, None, "Solar 응답에 choices가 없습니다"
    content = choices[0].get("message", {}).get("content", "")
    if not content:
        return None, None, "Solar 응답 content가 비어 있습니다"
    text = content.strip()
    # markdown code fence가 붙어 있으면 제거
    if text.startswith("```"):
        low = text.lower()
        idx = low.find("```")
        if idx == 0:
            end_idx = low.find("```", 3)
            if end_idx != -1:
                text = text[3:end_idx].strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None, None, f"JSON 객체를 찾을 수 없습니다 (첫 300자: {text[:300]!r})"
        try:
            parsed = json.loads(text[start:end + 1])
        except json.JSONDecodeError as exc:
            _dump_raw_content(content, exc)
            return None, None, f"JSON 파싱 실패: {exc}"

    revised_manuscript = parsed.get("revised_manuscript")
    if not isinstance(revised_manuscript, str) or not revised_manuscript.strip():
        return None, None, "응답에 'revised_manuscript'(고친 원고)가 없거나 비어 있습니다"

    changes = parsed.get("changes")
    if not isinstance(changes, list):
        changes = []
    else:
        # 각 항목에 item_index를 정규화한다
        normalized = []
        for i, ch in enumerate(changes):
            if not isinstance(ch, dict):
                continue
            item_index = ch.get("item_index")
            if item_index is None:
                item_index = i
            normalized.append(
                {
                    "item_index": item_index,
                    "subject": ch.get("subject") or "",
                    "change_description": ch.get("change_description") or "",
                    "original_snippet": ch.get("original_snippet") or "",
                    "revised_snippet": ch.get("revised_snippet") or "",
                }
            )
        changes = normalized

    return revised_manuscript, changes, None

# ─────────────────────── 길이 검증 ───────────────────────

def _revised_too_short(revised_manuscript, manuscript_text):
    """고친 원고가 원본 대비 지나치게 짧으면 True를 반환한다.

    원본이 비어 있으면 False.
    원본 길이의 30% 미만이면 너무 짧다고 본다.
    """
    orig_len = len(manuscript_text.strip())
    rev_len = len(revised_manuscript.strip())
    if orig_len == 0:
        return False
    return rev_len < orig_len * 0.3

# ─────────────────────── 메인 처리 ───────────────────────

def _process(settings_text, manuscript_text, confirmed_items, api_key):
    """Solar 호출 → 파싱 → 길이 검증 → 결과 조립."""
    prompt_text = _build_fix_prompt(settings_text, manuscript_text, confirmed_items)

    # 1) Solar 호출
    try:
        raw_resp = _call_solar(api_key, prompt_text)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return None, [], [f"Solar HTTP {exc.code}: {body}"]
    except urllib.error.URLError as exc:
        return None, [], [f"Solar 연결 실패: {exc.reason}"]
    except Exception as exc:
        return None, [], [f"Solar 호출 중 예기치 않은 오류: {exc}"]

    # 2) 응답 파싱
    revised_manuscript, changes, parse_error = _parse_fix_response(raw_resp)
    if parse_error:
        return None, [], [parse_error]

    # 3) 길이 검증
    if _revised_too_short(revised_manuscript, manuscript_text):
        return None, [], [
            f"고친 원고가 너무 짧습니다 (원본 {len(manuscript_text.strip())}자, "
            f"수정본 {len(revised_manuscript.strip())}자). 원고 전체가 반환되었는지 확인하라."
        ]

    # 4) 결과 조립
    summary = {
        "confirmed_count": len(confirmed_items),
        "revised_length": len(revised_manuscript.strip()),
        "original_length": len(manuscript_text.strip()),
    }
    return (
        revised_manuscript,
        changes,
        [],
        summary,
    )

# ─────────────────────── Vercel 핸들러 ───────────────────────

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            _fail(self, "요청 본문이 JSON이 아닙니다")
            return

        settings_text = body.get("settings_text")
        manuscript_text = body.get("manuscript_text")
        confirmed_items = body.get("confirmed_items")

        if not isinstance(settings_text, str) or not settings_text.strip():
            _fail(self, "settings_text(설정집 텍스트)가 필요합니다")
            return
        if not isinstance(manuscript_text, str) or not manuscript_text.strip():
            _fail(self, "manuscript_text(원고 텍스트)가 필요합니다")
            return
        if not isinstance(confirmed_items, list) or not confirmed_items:
            _fail(self, "confirmed_items(확정 항목 목록)가 필요합니다")
            return

        api_key = os.environ.get("UPSTAGE_API_KEY") or os.environ.get(
            "HERMES_CUSTOM_UPSTAGE_API_KEY"
        )
        if not api_key:
            _fail(
                self,
                "UPSTAGE_API_KEY 또는 HERMES_CUSTOM_UPSTAGE_API_KEY "
                "환경변수가 없습니다",
            )
            return

        revised_manuscript, changes, errors, summary = _process(
            settings_text, manuscript_text, confirmed_items, api_key
        )

        if errors:
            _fail(
                self,
                "; ".join(errors),
                confirmed_count=summary.get("confirmed_count", 0),
            )
            return

        _send_json(
            self,
            {
                "revised_manuscript": revised_manuscript,
                "summary": summary,
                "changes": changes,
                "errors": [],
            },
        )

    def log_message(self, format, *args):
        # Vercel 로그와 충돌하지 않도록 기본 로그 억제
        pass
