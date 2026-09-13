"""
api/refine.py — Vercel 파일 기반 Python 함수 (stdlib only)

POST /api/refine
  요청 JSON: { "proposed_additions": [ {"name":..., "count":N, "first_line":N,
                                          "context":..., "note":...}, ... ] }
  처리:
    1. proposed_additions를 Solar(solar-pro4)에 넘겨 고유명사만 판별
    2. 원고 전체는 보내지 않고 각 후보의 name + context(문맥)만 전달
    3. Solar 응답을 JSON 배열로 파싱 → is_proper / category / reason 부여
    4. 실패 시 원본 proposed_additions를 그대로 돌려주고 errors에 이유 기록
  프롬프트에는 JSON 예시를 넣지 않는다 (LLM이 예시를 배껴 없는 이름을
  지어내는 문제가 solar_extract.py에서 확인되었기 때문).
"""

import json
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

API_URL = "https://api.upstage.ai/v1/chat/completions"
MODEL = "solar-pro4"


def _send_json(handler, obj, status=200):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _dump_raw_content(content, exc):
    """파싱 실패 디버깅용: raw content 앞부분을 로그/파일로 남긴다."""
    head = content[:2000]
    msg = f"--- RAW CONTENT (앞 2000자, 파싱실패: {exc}) ---\n{head}\n--- END ---"
    print(msg, file=sys.stderr)


def _fail(handler, message, status=400):
    _send_json(handler, {"errors": [message], "refined": [], "kept_count": 0,
                         "dropped_count": 0}, status=status)


def _call_solar(api_key, prompt_text):
    """solar_extract.py의 call_solar를 간소화한 버전.

    - system 메시지: JSON만 출력
    - 유저 메시지: prompt_text (프롬프트 + 후보 목록)
    - model, temperature, response_format: solar_extract.py와 동일
    """
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content":
             "You output only a valid JSON array. No other text, no markdown."},
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


def _build_prompt(proposed_additions):
    """프롬프트 본문에 JSON 예시를 넣지 않고, 형식만 문장으로 설명한다.

    각 후보는 {name, context} 쌍으로 전달한다. 원고 전체는 보내지 않는다.
    """
    lines = []
    lines.append(
        "이 서비스는 웹소설 설정집을 만드는 도구다. "
        "후보가 소설 설정집에 적어둘 만한 이름이면 고유명사로 보고 is_proper: true로, "
        "그렇지 않으면 false로 판별하라."
    )
    lines.append("")
    lines.append(
        "남겨야 하는 것 (설정집에 적을 만한 고유명사): "
        "인물 이름, 지명, 조직이나 세력 이름, 작품 안에서만 쓰는 용어, "
        "몬스터나 종족 이름, 아이템이나 스킬 이름."
    )
    lines.append("")
    lines.append(
        "버리는 것 (일반 명사/일반어): "
        "일반 명사, 대명사, 동사나 형용사 조각, "
        "실존하는 일반 상식 단어(보통 명사)."
    )
    lines.append("")
    lines.append(
        "특히 판타지·웹소설 문맥에서는 다음을 고유명사로 본다: "
        "특정 조직·세력·팀·집단 이름(예: 베나토르), "
        "작품 안에서만 쓰는 제도·개념·단계·용어(예: 소원권, 튜토리얼), "
        "몬스터·종족 이름(예: 고블린)."
    )
    lines.append("")
    lines.append(
        "경고: 아래 문맥만으로 판단하되, '세종', '서울', '국정원', '경찰', '군사'처럼 "
        "실제 현실에 존재하거나 일반 상식에 가까운 단어라도 "
        "작품 안에서 고유명사/설정 용어로 쓰였는지 문맥에서 확인하라. "
        "예) '종로경찰서'는 문맥상 작품 내 지명/기관으로 쓰였으면 고유명사로 본다."
    )
    lines.append("")
    lines.append(
        "애매하면 is_proper: false로 두고 결과 배열에 넣지 마라. "
        "확실한 것만 is_proper: true로 넣어라. "
        "일반 사물 이름(무기·도구·돈·보상·상태·감정 같은 보통 명사)은 "
        "그 작품에서만 특별한 의미를 갖는 게 아니면 제외하라. "
        "조사나 어미가 붙은 형태(예: '...는', '...을', '...가', '...의' 등)는 "
        "핵심 명사만 보고 판별하고, 그런 정형적 굴절 형태는 고유명사 후보에서 빼라. "
        "설정집 반영 여부는 사용자가 마지막에 정한다."
    )
    lines.append(
        "  {"
        "\"name\": \"후보 이름\", "
        "\"is_proper\": true 또는 false, "
        "\"category\": \"인물\"|\"지명\"|\"세계관\"|\"기타\"|\"모르겠음\", "
        "\"reason\": \"짧은 근거 문장\""
        "}"
    )
    lines.append("")
    lines.append("원고 전체는 제공하지 않는다. 아래 문맥만으로 판단하라.")
    lines.append("")

    for i, item in enumerate(proposed_additions, start=1):
        name = item.get("name", "")
        context = item.get("context", "")
        lines.append(f"{i}. name: {name!r}, context: {context!r}")

    lines.append(
        "결과는 반드시 다음 구조의 JSON 하나만 출력하라:"
    )
    lines.append(
        "  {"
        "\"candidates\": ["
        "위 구조를 갖는 객체들을 넣되, "
        "is_proper가 true인 것만 배열에 포함한다"
        "]"
        "}"
    )
    return "\n".join(lines)


def _parse_solar_response(raw_resp):
    """Solar 응답을 파싱해 candidates 배열을 추출한다.

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
        # 위 방식이 안 되면 예전처럼 첫 { ~ 마지막 }로 잘라 시도
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None, f"JSON 객체를 찾을 수 없습니다 (첫 300자: {text[:300]!r})"
        try:
            parsed = json.loads(text[start:end + 1])
        except json.JSONDecodeError as exc:
            _dump_raw_content(content, exc)
            return None, f"JSON 파싱 실패: {exc}"

    candidates = parsed.get("candidates")
    if not isinstance(candidates, list):
        return None, (
            f"응답에 'candidates' 배열이 없습니다 "
            f"(받은 형태: {type(parsed).__name__})"
        )

    return candidates, None


def _refine(proposed_additions, api_key):
    """proposed_additions를 Solar로 정제한다.

    반환값: (results_list, errors_list)
      - 성공 시: 각 항목에 is_proper/category/reason을 붙인 목록
      - 실패 시: errors만 남고 results는 빈 목록 (원본은 호출부가 그대로 반환)
    """
    prompt_text = _build_prompt(proposed_additions)

    try:
        raw_resp = _call_solar(api_key, prompt_text)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return [], [f"Solar HTTP {exc.code}: {body}"]
    except urllib.error.URLError as exc:
        return [], [f"Solar 연결 실패: {exc.reason}"]
    except Exception as exc:
        return [], [f"Solar 호출 중 예기치 않은 오류: {exc}"]

    candidates, parse_error = _parse_solar_response(raw_resp)
    if parse_error:
        return [], [parse_error]

    # 원고에 없는 / 매핑되지 않은 후보는 '이유 없음'으로 처리하되
    # is_proper는 false로 둔다 (안전 쪽).
    refined = []
    for item in proposed_additions:
        name = item.get("name", "")
        matched = next((c for c in candidates if c.get("name") == name), None)

        if matched is None:
            refined.append({
                "name": name,
                "is_proper": False,
                "category": "기타",
                "reason": "Solar가 이 후보를 판별하지 않았습니다",
                "count": item.get("count"),
                "first_line": item.get("first_line"),
                "context": item.get("context"),
                "note": item.get("note"),
            })
        else:
            refined.append({
                "name": name,
                "is_proper": bool(matched.get("is_proper")),
                "category": matched.get("category", "기타"),
                "reason": matched.get("reason", ""),
                "count": item.get("count"),
                "first_line": item.get("first_line"),
                "context": item.get("context"),
                "note": item.get("note"),
            })

    return refined, []


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            _fail(self, "요청 본문이 JSON이 아닙니다")
            return

        proposed = body.get("proposed_additions")
        if not isinstance(proposed, list):
            _fail(self, "proposed_additions 배열이 필요합니다")
            return

        api_key = os.environ.get("UPSTAGE_API_KEY") or os.environ.get(
            "HERMES_CUSTOM_UPSTAGE_API_KEY")
        if not api_key:
            _fail(self, "UPSTAGE_API_KEY 또는 HERMES_CUSTOM_UPSTAGE_API_KEY "
                         "환경변수가 없습니다")
            return

        results, errors = _refine(proposed, api_key)

        kept = sum(1 for r in results if r.get("is_proper"))
        dropped = len(results) - kept

        out = {
            "refined": results,
            "kept_count": kept,
            "dropped_count": dropped,
            "errors": errors,
        }
        _send_json(self, out)

    def log_message(self, format, *args):
        # Vercel 로그와 충돌하지 않도록 기본 로그 억제
        pass
