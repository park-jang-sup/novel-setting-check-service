"""
api/enrich.py — Vercel 파일 기반 Python 함수 (stdlib only)

POST /api/enrich
  요청 JSON:
  {
    "candidate_names": [ {"name": "...", "episode": 3}, ... ],
    "settings_text": "# 등장인물\\n\\n## 유진혁\\n- 나이: 19\\n...",
    "manuscript_text": "1화 시산혈해... (원고 전체)",
  }
  처리:
    1. 설정집 + 원고 전체 + 인물 이름 목록을 Solar(solar-pro4)에 넘겨,
       각 인물에 대해 원고에서 드러난 나이/소속/별칭/비고와 근거 문장을 채우게 한다.
    2. Solar 응답을 JSON으로 파싱한다.
    3. 각 필드의 evidence(근거 문장)가 원고에 실제 존재하는지 문자열 매칭으로 검증한다.
       - evidence가 원고에 없으면 해당 값은 넣지 않는다(빈 값 처리).
       - age는 숫자값만 허용한다. age.value가 숫자가 아니거나
         age.evidence가 원고에 없으면 age는 비운다.
    4. 중간 상태(flagged)는 두지 않는다.
       근거 문장이 원고에 있으면 넣고, 없으면 비우는 두 가지뿐이다.
  프롬프트에는 JSON 예시 값(특정 이름·공백·설정)을 넣지 않는다.
  출력 구조는 문장으로만 설명한다.
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

def _fail(handler, message, status=400):
    _send_json(
        handler,
        {
            "enriched": [],
            "errors": [message],
        },
        status=status,
    )

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

# ─────────────────────── 프롬프트 ───────────────────────

def _build_prompt(settings_text, manuscript_text, candidate_names):
    """인물 이름 목록, 설정집, 원고 전체를 솔라에 보내 인물 필드를 채우게 한다.

    출력 구조 예시는 문장 형태로만 설명하고, 특정 이름이나 설정 값을
    시연 예시로 넣지 않는다.
    """

    lines = []
    lines.append(
        "이 서비스는 웹소설 설정집과 회차 원고를 함께 읽고, "
        "설정집에 들어갈 인물 정보를 보강하는 도구다."
    )
    lines.append("")
    lines.append(
        "아래에 (1) 설정집, (2) 회차 원고 전체, (3) 인물 이름 목록이 주어진다."
    )
    lines.append("")
    lines.append(
        "당신은 원고를 읽고, 인물 이름 목록에 있는 각 인물에 대해 "
        "원고에 드러난 다음 정보를 JSON으로만 출력해야 한다."
    )
    lines.append("")
    lines.append("대상 필드:")
    lines.append(
        "  - age: 인물 나이. 숫자는 그대로 적고, "
        "원문에 한글 나이 표현(스물두 살, 스무 살 등)이 있으면 "
        "그 표현에 해당하는 숫자로 환산해서 적는다. "
        "숫자로 환산할 수 없으면 age는 비운다(null 또는 값 없음)."
    )
    lines.append(
        "  - affiliation: 인물 소속/직책/조직/세력. "
        "원문에 드러나는 것만 적고, 없으면 비운다."
    )
    lines.append(
        "  - aliases: 인물이 불린 별칭·호칭·별명. "
        "문자열 목록으로 적고, 없으면 빈 목록이거나 비운다."
    )
    lines.append(
        "  - notes: 인물에 대한 설명·상황·성격·역할 같은 비고. "
        "원문에 드러나는 것만 짧게 적고, 없으면 비운다."
    )
    lines.append("")
    lines.append(
        "각 필드에는 value와 함께 evidence(근거 문장)를 함께 적는다. "
        "evidence는 해당 value를 뽑을 때 사용한 원고 문장이다. "
        "원문에 그 필드의 근거가 전혀 없으면 해당 필드는 비워 둔다."
    )
    lines.append("")
    lines.append("출력 JSON 구조(하나만 출력):")
    lines.append(
        "  {"
        "\"characters\": ["
        "{"
        "\"name\": 인물 이름,"
        "\"fields\": {"
        "\"age\": 숫자 또는 null,"
        "\"ageEvidence\": 근거 문장 또는 null,"
        "\"affiliation\": 문자열 또는 null,"
        "\"affiliationEvidence\": 근거 문장 또는 null,"
        "\"aliases\": 문자열 목록 또는 null,"
        "\"aliasesEvidence\": 근거 문장 또는 null,"
        "\"notes\": 문자열 또는 null,"
        "\"notesEvidence\": 근거 문장 또는 null"
        "}"
        "}"
        "]"
        "}"
    )
    lines.append("")
    lines.append(
        "위 구조만 사용한다. 추가 필드는 넣지 않는다. "
        "각 문자는 구조 설명이며 특정 이름이나 설정을 예시한 것이 아니다."
    )
    lines.append("")
    lines.append("─── (1) 설정집 ───")
    lines.append(settings_text)
    lines.append("")
    lines.append("─── (2) 회차 원고 전체 ───")
    lines.append(manuscript_text)
    lines.append("")
    lines.append("─── (3) 인물 이름 목록 ───")
    for i, item in enumerate(candidate_names, start=1):
        name = item.get("name", "")
        episode = item.get("episode")
        episode_part = f", episode: {episode}" if episode is not None else ""
        lines.append(f"{i}. name: {name!r}{episode_part}")
    lines.append("")
    lines.append(
        "인물 이름 목록에 있는 인물이 원고에 나오지 않으면 "
        "그 인물은 characters 배열에 넣지 않는다."
    )

    return "\n".join(lines)

# ─────────────────────── 응답 파싱 ───────────────────────

def _parse_solar_response(raw_resp):
    """Solar 응답을 파싱해 characters 배열을 추출한다.

    실패 시 (None, error_message) 반환.
    """

    choices = raw_resp.get("choices", [])
    if not choices:
        return None, "Solar 응답에 choices가 없습니다"

    content = choices[0].get("message", {}).get("content", "")
    if not content:
        return None, "Solar 응답 content가 비어 있습니다"

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
            return None, f"JSON 객체를 찾을 수 없습니다 (첫 300자: {text[:300]!r})"
        try:
            parsed = json.loads(text[start:end + 1])
        except json.JSONDecodeError as exc:
            return None, f"JSON 파싱 실패: {exc}"

    chars = parsed.get("characters")
    if not isinstance(chars, list):
        return None, (
            f"응답에 'characters' 배열이 없습니다 "
            f"(받은 형태: {type(parsed).__name__})"
        )

    return chars, None

# ─────────────────────── 검증 ───────────────────────

def _norm(text: str) -> str:
    """공백/개행 차이를 어느 정도 흡수한 정규화 텍스트."""
    if text is None:
        return ""
    return re.sub(r"\s+", " ", text).strip()

def _evidence_is_in_manuscript(evidence: str, manuscript_norm: str) -> bool:
    """evidence(근거 문장)가 원고에 실제 포함되어 있는지 확인한다.

    부분 일치로 검사하며, 공백/개행 차이를 어느 정도 허용한다.
    """

    if not evidence:
        return False
    return _norm(evidence) in manuscript_norm

def _is_number(val):
    """val이 숫자(정수/실수)이면 True. 문자열 숫자도 허용."""
    if isinstance(val, (int, float)):
        return True
    if isinstance(val, str):
        s = val.strip()
        if not s:
            return False
        try:
            float(s)
            return True
        except ValueError:
            return False
    return False

def _to_number(val):
    """val을 숫자로 변환. 변환 안 되면 None."""
    if isinstance(val, (int, float)):
        return val
    if isinstance(val, str):
        s = val.strip()
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None

# ─────────────────────── 메인 처리 ───────────────────────

def _process(settings_text, manuscript_text, candidate_names, api_key):
    """Solar 호출 → 파싱 → 근거 검증 → 결과 조립."""

    prompt_text = _build_prompt(settings_text, manuscript_text, candidate_names)

    # 1) Solar 호출
    try:
        raw_resp = _call_solar(api_key, prompt_text)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return [], [f"Solar HTTP {exc.code}: {body}"]
    except urllib.error.URLError as exc:
        return [], [f"Solar 연결 실패: {exc.reason}"]
    except Exception as exc:
        return [], [f"Solar 호출 중 예기치 않은 오류: {exc}"]

    # 2) 응답 파싱
    chars, parse_error = _parse_solar_response(raw_resp)
    if parse_error:
        return [], [parse_error]

    if not chars:
        return [], []

    manuscript_norm = _norm(manuscript_text)

    # 3) 근거 검증 + age 숫자화
    enriched = []
    for char in chars:
        if not isinstance(char, dict):
            continue
        name = (char.get("name") or "").strip()
        if not name:
            continue
        fields = char.get("fields")
        if not isinstance(fields, dict):
            fields = {}

        episode = char.get("episode")

        # age
        age_val = fields.get("age")
        age_ev = fields.get("ageEvidence") or ""
        age_out = None
        age_ev_out = None
        if _is_number(age_val) and _evidence_is_in_manuscript(age_ev, manuscript_norm):
            age_out = _to_number(age_val)
            age_ev_out = age_ev if _evidence_is_in_manuscript(age_ev, manuscript_norm) else None
        elif _is_number(age_val):
            # 숫자지만 evidence가 없으면 비움
            age_out = None
            age_ev_out = None

        # affiliation
        aff_val = fields.get("affiliation")
        aff_ev = fields.get("affiliationEvidence") or ""
        aff_out = None
        aff_ev_out = None
        if isinstance(aff_val, str) and aff_val.strip() and _evidence_is_in_manuscript(aff_ev, manuscript_norm):
            aff_out = aff_val.strip()
            aff_ev_out = aff_ev
        elif isinstance(aff_val, str) and aff_val.strip():
            # 값은 있지만 evidence가 원고에 없으면 비움
            aff_out = None
            aff_ev_out = None

        # aliases
        aliases_val = fields.get("aliases")
        aliases_ev = fields.get("aliasesEvidence") or ""
        aliases_out = None
        aliases_ev_out = None
        if isinstance(aliases_val, list) and aliases_val and _evidence_is_in_manuscript(aliases_ev, manuscript_norm):
            cleaned = [str(x).strip() for x in aliases_val if x is not None and str(x).strip()]
            if cleaned:
                aliases_out = cleaned
                aliases_ev_out = aliases_ev
        elif isinstance(aliases_val, list):
            aliases_out = None
            aliases_ev_out = None

        # notes
        notes_val = fields.get("notes")
        notes_ev = fields.get("notesEvidence") or ""
        notes_out = None
        notes_ev_out = None
        if isinstance(notes_val, str) and notes_val.strip() and _evidence_is_in_manuscript(notes_ev, manuscript_norm):
            notes_out = notes_val.strip()
            notes_ev_out = notes_ev
        elif isinstance(notes_val, str) and notes_val.strip():
            notes_out = None
            notes_ev_out = None

        enriched.append({
            "name": name,
            "episode": episode,
            "fields": {
                "age": age_out,
                "affiliation": aff_out,
                "aliases": aliases_out,
                "notes": notes_out,
            },
            "source": "solar",
            "ageEvidence": age_ev_out,
            "affiliationEvidence": aff_ev_out,
            "notesEvidence": notes_ev_out,
        })

    return enriched, []

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

        candidate_names = body.get("candidate_names")
        settings_text = body.get("settings_text")
        manuscript_text = body.get("manuscript_text")

        if not isinstance(candidate_names, list) or not candidate_names:
            _fail(self, "candidate_names(보강할 인물 이름 목록)가 필요합니다")
            return
        if not isinstance(settings_text, str) or not settings_text.strip():
            _fail(self, "settings_text(설정집 텍스트)가 필요합니다")
            return
        if not isinstance(manuscript_text, str) or not manuscript_text.strip():
            _fail(self, "manuscript_text(원고 텍스트)가 필요합니다")
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

        enriched, errors = _process(settings_text, manuscript_text, candidate_names, api_key)

        out = {
            "enriched": enriched,
            "errors": errors,
        }
        _send_json(self, out)

    def log_message(self, format, *args):
        # Vercel 로그와 충돌하지 않도록 기본 로그 억제
        pass
