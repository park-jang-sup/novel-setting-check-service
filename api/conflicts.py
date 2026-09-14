"""
api/conflicts.py — Vercel 파일 기반 Python 함수 (stdlib only)

POST /api/conflicts
  요청 JSON:
  {
    "settings_text": "# 등장인물\n\n## 유진혁\n- 나이: 19\n...",
    "manuscript_text": "1화 시산혈해... (원고 전체)",
    "rule_findings": {
      "summary": {...},
      "violations": [ {type,severity,line,subject,detail,context,...} ... ],
      "proposed_additions": [...]
    }
  }
  처리:
    1. 설정집 + 원고 + 규칙 결과를 Solar(solar-pro4)에 넘겨,
       규칙이 이미 찾은 충돌을 제외한 "새로운 설정 충돌"만 찾게 한다.
    2. Solar 응답을 JSON 배열로 파싱한다.
    3. 근거(evidence)가 원고에 실제 존재하는지 문자열 매칭으로 검증한다.
    4. 규칙 findings와 중복되는 항목을 함수 안에서 제거한다
       (subject + type 매핑 + detail 중첩 기준, 한 가지 기준).
    5. 검증 통과 + 중복 제거된 충돌만 violations로 반환하고,
       제거/무효 항목은 dropped로 남긴다.
  프롬프트에는 JSON 예시를 넣지 않는다 (LLM이 예시를 배껴 없는 충돌을
  만들어 내는 문제를 피하기 위함).
"""

import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

API_URL = "https://api.upstage.ai/v1/chat/completions"
MODEL = "solar-pro4"

# ─────────────────────── Solar → 규칙 type 매핑 ───────────────────────
# Solar가 쓰는 type 이름이 규칙(check_setting.py)과 다를 수 있으므로,
# 중복 판단 및 프론트 통일 표시를 위해 규칙 type으로 변환한다.
SOLAR_TYPE_TO_RULE_TYPE = {
    "age_mismatch": "age_conflict",
    "ability_mismatch": "ability_candidate",
    "timeline_conflict": "timeline_reverse",
    "term_writting_change": "name_variant",
    "other_setting_conflict": "other_setting_conflict",
    "term_mismatch": "term_mismatch",
}

# ─────────────────────── 응답 헬퍼 ───────────────────────

def _send_json(handler, obj, status=200):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _dump_raw_content(content, exc):
    """파싱 실패 디버깅용: raw content 앞부분을 stderr로 남긴다."""
    head = content[:2000]
    msg = (
        f"--- RAW CONTENT (앞 2000자, 파싱실패: {exc}) ---\n"
        f"{head}\n"
        f"--- END ---"
    )
    print(msg, file=__import__("sys").stderr)


def _fail(handler, message, status=400):
    _send_json(
        handler,
        {
            "summary": {
                "total_found": 0,
                "after_dedup": 0,
                "dropped_rule_dup": 0,
                "invalid_evidence": 0,
            },
            "violations": [],
            "dropped": [],
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


def _build_prompt(settings_text, manuscript_text, rule_findings):
    """규칙 결과를 고려하되, 규칙이 못 잡은 충돌만 찾게 하는 프롬프트.

    규칙 findings를 그대로 Solar에게 보여주고, "이미 규칙에 있는 건 제외"
    하도록 지시한다. JSON 예시는 넣지 않는다.
    """
    lines = []
    lines.append(
        "이 서비스는 웹소설 설정집과 회차 원고를 비교해 설정 충돌을 찾는 도구다."
    )
    lines.append("")
    lines.append(
        "당신은 설정집과 원고를 모두 읽고, "
        "설정집 정보와 원고 표현이 충돌하는 지점을 찾는다."
    )
    lines.append("")
    lines.append(
        "아래에 (1) 설정집, (2) 회차 원고 전체, (3) 규칙 기반 검사기가 "
        "이미 찾아둔 충돌 목록을 준다."
    )
    lines.append("")
    lines.append(
        "규칙이 이미 찾은 충돌은 제외하고, 규칙이 놓친 충돌만 새로 찾아서 "
        "JSON 배열로 출력하라."
    )
    lines.append("")
    lines.append("특히 아래를 신경 써라.")
    lines.append(
        "  - 1인칭 원고면 '나'의 나이·상태 표현도 대조 대상이다."
    )
    lines.append(
        "    나이·세·살·해 같은 숫자 표현과 열, 스물, 서른 처럼 한글로 쓴 나이 표현 모두 본다."
    )
    lines.append(
        "    '나'가 누군지는 원고에서 호명되는 이름을 기준으로 판단하라."
    )
    lines.append(
        "  - 나이는 설정집에 적힌 나이와 같은 숫자를 가리키면 충돌이 아니다. "
        "다른 숫자를 가리킬 때만 충돌로 본다. "
        "비유·수사처럼 보여도 실제 가리키는 숫자가 설정집 나이와 다르면 충돌이다. "
        "1인칭 서술자의 독백·자전적 서술에 나오는 나이 표현도 포함한다."
    )
    lines.append(
        "  - 스킬·능력·아이템 이름이 얻는 장면과 쓰는 장면에서 서로 다르면 "
        "용어 불일치로 잡아라. type은 'term_mismatch'로 하고, "
        "이것은 설정집에 없어도 찾아라."
    )
    lines.append(
        "    같은 대상이 앞과 뒤에서 서로 다른 이름으로 불리는 경우가 여러 번 나와도 "
        "한 건으로 합쳐서 출력하라."
    )
    lines.append(
        "  - 설정집의 비고에 적힌 설정(회귀, 시간 이동, 과거 회귀 등)은 존중하라. "
        "그 설정 때문에 생긴 시간 순서 역전은 충돌로 보지 마라."
    )
    lines.append(
        "  - 불가 항목은 그 단어(예: '마법')가 원고에 직접 쓰일 때만 판단하라. "
        "스킬·능력 자체를 불가 항목으로 해석하지 마라."
    )
    lines.append(
        "  - 나이는 원고에 숫자나 나이 표현(살/세/해, 스무/스물 등)이 명시된 것만 다뤄라. "
        "날짜·생일·연수 계산으로 추론해서 나이 충돌을 만들지 마라."
    )
    lines.append(
        "  - 오타, 말 끊김, 죽어가는 대사 같은 것은 표기 불일치로 보지 마라."
    )
    lines.append(
        "  - 최대 5건까지만 출력하라. 확실하지 않은 것은 넣지 마라."
    )
    lines.append("")
    lines.append(
        "근거 규칙: 각 충돌 항목의 evidence는 반드시 원고에 실제 존재하는 "
        "문장이어야 한다. 원고에 없는 문장을 지어내지 마라."
    )
    lines.append("")
    lines.append("출력 JSON 구조 (하나만 출력):")
    lines.append(
        "  {"
        '"conflicts": ['
        "{"
        '"type": "age_mismatch" | "timeline_conflict" | "term_mismatch" | "other_setting_conflict",'
        '"severity": "high" | "medium" | "low",'
        '"line": <원고 줄 번호>,'
        '"subject": "충돌 대상의 짧은 이름",'
        '"detail": "무슨 충돌인지 한 문장",'
        '"evidence": "원고 근거 문장(원문에 실제 있는 문장만)",'
        '"context": "증거 문장 앞뒤의 짧은 원문 스니펫"'
        "}"
        "]"
        "}"
    )
    lines.append("")
    lines.append(
        "각 필드는 위 구조만 쓴다. 추가 필드는 넣지 않는다."
    )
    lines.append("")
    lines.append("─── (1) 설정집 ───")
    lines.append(settings_text)
    lines.append("")
    lines.append("─── (2) 회차 원고 전체 ───")
    lines.append(manuscript_text)
    lines.append("")
    lines.append("─── (3) 규칙이 이미 찾은 충돌 목록 ───")
    lines.append(_rule_findings_summary(rule_findings))
    lines.append("")
    lines.append(
        "위 (3)과 같은 충돌은 제외하라. "
        "subject/type/detail이 비슷한 것도 가능하면 빼고, "
        "진짜 새로 보이는 충돌만 출력하라."
    )
    return "\n".join(lines)


def _rule_findings_summary(rule_findings):
    """규칙 findings를 Solar가 읽기 쉬운 요약 문자열로 만든다."""
    if not isinstance(rule_findings, dict):
        return "규칙 결과가 주어지지 않았습니다."

    violations = rule_findings.get("violations") or []
    if not isinstance(violations, list) or not violations:
        return "규칙이 찾은 충돌이 없습니다."

    parts = []
    for v in violations:
        if not isinstance(v, dict):
            continue
        subject = v.get("subject") or "?"
        vtype = v.get("type") or "?"
        detail = v.get("detail") or ""
        if detail:
            parts.append(f"- [{vtype}] {subject}: {detail}")
        else:
            parts.append(f"- [{vtype}] {subject}")
    return "\n".join(parts[:200])  # 너무 길면 뒤에서 자름


# ─────────────────────── 응답 파싱 ───────────────────────

def _parse_solar_response(raw_resp):
    """Solar 응답을 파싱해 conflicts 배열을 추출한다.

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
            _dump_raw_content(content, exc)
            return None, f"JSON 파싱 실패: {exc}"

    conflicts = parsed.get("conflicts")
    if not isinstance(conflicts, list):
        return None, (
            f"응답에 'conflicts' 배열이 없습니다 "
            f"(받은 형태: {type(parsed).__name__})"
        )

    return conflicts, None


# ─────────────────────── 근거 검증 ───────────────────────

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


def _evidence_line_in_manuscript(evidence: str, manuscript_text: str) -> int:
    """evidence(근거 문장)가 원고에서 실제로 등장하는 가장 빠른 줄 번호를 계산한다.

    - 원본 원고 텍스트에서 evidence가 처음 등장하는 위치를 찾는다.
    - 증거 문장은 원고에 실제로 존재해야 한다(없으면 0을 반환해도 무방하나,
      이 함수는 근거 검증을 통과한 뒤에만 호출하는 것을 전제로 한다).
    - 줄 번호는 1부터 센다.
    """
    if not evidence:
        return 0
    needle = _norm(evidence)
    haystack = _norm(manuscript_text)
    if not needle or not haystack:
        return 0
    idx = haystack.find(needle)
    if idx < 0:
        # 정규화본에서도 못 찾으면 원본 텍스트 기준으로도 못 찾은 것으로 본다
        return 0
    # 정규화 전 원본 텍스트에서 같은 내용의 시작 위치를 근사한다.
    # 정규화로 공백이 collapsed되었으므로, 원본에서 needle의 첫 토큰으로 위치를 찾는다.
    first_token = evidence.strip().split()[0] if evidence.strip() else ""
    if not first_token:
        return 0
    pos = manuscript_text.find(first_token, 0)
    if pos < 0:
        return 0
    return manuscript_text.count("\n", 0, pos) + 1


# ─────────────────────── 중복 제거 (규칙 findings 기준) ───────────────────────

def _rule_type(t):
    """솔라 type을 (매핑 가능하면) 규칙 type으로 변환한다."""
    if not isinstance(t, str):
        return t
    return SOLAR_TYPE_TO_RULE_TYPE.get(t, t)


def _detail_overlap(a: str, b: str) -> bool:
    """두 detail 문장이 서로 포함 관계이면 True.

    공백 정규화 후 한쪽이 다른 쪽에 포함되면 겹치는 것으로 본다.
    """
    na = _norm(a)
    nb = _norm(b)
    if not na or not nb:
        return False
    return na in nb or nb in na


def _as_rule_dup_conflict(item, rule_entry):
    """솔라 항목과 규칙 항목을 '같은 건으로 판단'한 기록을 만든다."""
    return {
        "reason": "rule_duplicate",
        "item": {
            "type": item.get("type"),
            "subject": item.get("subject"),
            "detail": item.get("detail"),
            "line": item.get("line"),
            "evidence": item.get("evidence"),
        },
        "matched_rule": {
            "subject": rule_entry.get("subject"),
            "type": rule_entry.get("type"),
            "detail": rule_entry.get("detail"),
        },
    }


def _dedup_solar_violations(solar_items, rule_violations):
    """솔라 violations에서 규칙 findings와 중복되는 항목을 제거한다.

    기준(한 가지):
      subject가 같고,
      type(규칙 type으로 변환 후)이 같거나,
      detail이 서로 포함 관계이면
      → 같은 충돌로 본다.

    rule_violations는 규칙이 이미 찾은 violations (CheckResult.violations와 동일 shape)
    반환값:
      kept: 중복 제거된 솔라 violations (규칙 type으로 통일, source="solar" 부착)
      dropped: 제거된 항목 기록 (중복 이유 + matched_rule 포함)
    """
    kept = []
    dropped = []

    # 규칙 findings를 비교용 목록으로 준비 (type은 이미 규칙 타입)
    rule_list = [rv for rv in rule_violations if isinstance(rv, dict)]

    for item in solar_items:
        if not isinstance(item, dict):
            continue
        s_type = _rule_type(item.get("type"))
        s_subject = (item.get("subject") or "").strip()
        s_detail = (item.get("detail") or "")

        is_dup = False
        matched_rule = None

        for rv in rule_list:
            r_subject = (rv.get("subject") or "").strip()
            r_type = rv.get("type") or ""
            r_detail = (rv.get("detail") or "")

            # subject 동일 + (type 동일 또는 detail 중첩)
            if s_subject and r_subject and s_subject == r_subject:
                if s_type == r_type:
                    is_dup = True
                    matched_rule = rv
                    break
                if _detail_overlap(s_detail, r_detail):
                    is_dup = True
                    matched_rule = rv
                    break

        if is_dup:
            dropped.append(
                _as_rule_dup_conflict(item, matched_rule or {"subject": r_subject, "type": r_type, "detail": r_detail})
            )
            continue

        # 중복 아니면 유지. type은 규칙 type으로 통일하고 source 부착
        kept.append(
            {
                "type": s_type,
                "severity": item.get("severity") or "medium",
                "line": item.get("_line") or item.get("line") or 0,
                "subject": item.get("subject") or "",
                "detail": item.get("detail") or "",
                "context": item.get("context") or "",
                "source": "solar",
            }
        )

    return kept, dropped


def _merge_same_term_mismatch(violations, manuscript_text):
    """term_mismatch 유형끼리 같은 용어 쌍이면 한 건으로 합친다.

    - type이 'term_mismatch'인 항목만 대상.
    - subject가 같고 detail에서 가리키는 용어 쌍이 같은 건들을 병합.
    - 병합 시 가장 앞선 줄 번호를 사용하고, context는 evidence들의
      가장 이른 위치를 기준으로 넓게 잡은 원고로 유지한다.
    """
    if not violations:
        return violations

    term_items = [v for v in violations if v.get("type") == "term_mismatch"]
    if len(term_items) <= 1:
        return violations

    merged_map: dict[int, list[int]] = {}
    used = set()

    def _term_pair_key(item):
        detail_norm = _norm(item.get("detail") or "")
        terms = re.findall(r"[\'\"]?([^\',\"]+?)[\'\"]?", detail_norm)
        cand = [t.strip() for t in terms if len(t.strip()) >= 2]
        if len(cand) >= 2:
            return tuple(sorted(set(cand)))
        return None

    for i in range(len(term_items)):
        if i in used:
            continue
        ki = _term_pair_key(term_items[i])
        if ki is None:
            continue
        group = [i]
        for j in range(i + 1, len(term_items)):
            if j in used:
                continue
            kj = _term_pair_key(term_items[j])
            if kj is not None and kj == ki:
                group.append(j)
                used.add(j)
        if len(group) > 1:
            merged_map[i] = group
            used.add(i)

    if not merged_map:
        return violations

    kept: list[dict] = []
    used_indices: set[int] = set()
    for rep_i, group in merged_map.items():
        rep = term_items[rep_i]
        evidences = [rep.get("evidence") or ""]
        for gi in group:
            evidences.append(term_items[gi].get("evidence") or "")
        context = _merge_context(evidences, manuscript_text)
        earliest_line = min(
            (term_items[gi].get("_line") or term_items[gi].get("line") or 0)
            for gi in group
        )
        kept.append(
            {
                "type": "term_mismatch",
                "severity": rep.get("severity") or "medium",
                "line": earliest_line,
                "subject": rep.get("subject"),
                "detail": rep.get("detail"),
                "context": context,
                "source": "solar",
            }
        )
        used_indices.update(group)
        used_indices.add(rep_i)

    other = [v for v in violations if v.get("type") != "term_mismatch"]
    for vi, v in enumerate(term_items):
        if vi not in used_indices and vi not in merged_map:
            kept.append(v)

    return other + kept


def _merge_context(evidences, manuscript_text):
    """evidence 목록 중 가장 이른 위치를 기준으로 주변 맥락을 넓힌다."""
    if not evidences:
        return ""
    manuscript_norm = _norm(manuscript_text)
    best_start = None
    best_len = 0
    for ev in evidences:
        if not ev:
            continue
        needle = _norm(ev)
        idx = manuscript_norm.find(needle)
        if idx < 0:
            continue
        if best_start is None or idx < best_start:
            best_start = idx
            best_len = len(needle)
    if best_start is None:
        first = next((e for e in evidences if e), "")
        return first
    span = max(best_len, 60)
    span = min(span, 200)
    end = min(len(manuscript_norm), best_start + span)
    return manuscript_norm[best_start:end].strip()


# ─────────────────────── 메인 처리 ───────────────────────

def _process(settings_text, manuscript_text, rule_findings, api_key):
    """Solar 호출 → 파싱 → 근거 검증 → 중복 제거 → 결과 조립."""
    prompt_text = _build_prompt(settings_text, manuscript_text, rule_findings)

    # 1) Solar 호출
    try:
        raw_resp = _call_solar(api_key, prompt_text)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return None, [f"Solar HTTP {exc.code}: {body}"], [], []
    except urllib.error.URLError as exc:
        return None, [f"Solar 연결 실패: {exc.reason}"], [], []
    except Exception as exc:
        return None, [f"Solar 호출 중 예기치 않은 오류: {exc}"], [], []

    # 2) 응답 파싱
    conflicts, parse_error = _parse_solar_response(raw_resp)
    if parse_error:
        return None, [parse_error], [], []

    if not conflicts:
        return {
            "summary": {
                "total_found": 0,
                "after_dedup": 0,
                "dropped_rule_dup": 0,
                "invalid_evidence": 0,
            },
            "violations": [],
            "dropped": [],
            "errors": [],
        }, [], [], []

    manuscript_norm = _norm(manuscript_text)

    # 3) 근거 검증 + type 정규화
    valid_with_norm_type = []
    invalid_evidence_items = []

    for item in conflicts:
        evidence = item.get("evidence") or ""
        if not _evidence_is_in_manuscript(evidence, manuscript_norm):
            invalid_evidence_items.append(
                {
                    "type": item.get("type"),
                    "subject": item.get("subject"),
                    "detail": item.get("detail"),
                    "line": item.get("line"),
                    "evidence": evidence,
                }
            )
            continue
        # type은 아직 솔라 type일 수 있으니 규칙 type으로 변환해 둔다
        item["_rule_type"] = _rule_type(item.get("type"))
        # evidence를 기준으로 실제 원고 줄 번호를 재계산한다
        item["_line"] = _evidence_line_in_manuscript(evidence, manuscript_text)
        valid_with_norm_type.append(item)

    # 4) 규칙 findings와 중복 제거 (근거 통과한 것만 대상)
    rule_violations = rule_findings.get("violations") or []
    kept_deduped, dropped_dup = _dedup_solar_violations(
        valid_with_norm_type, rule_violations
    )

    # 5) output violations 조립: type은 규칙 type으로, line은 evidence 기준 실제 줄 번호로 교체
    out_violations = []
    for item in kept_deduped:
        out_violations.append(
            {
                "type": item.get("_rule_type") or item.get("type"),
                "severity": item.get("severity"),
                "line": item.get("_line") or item.get("line") or 0,
                "subject": item.get("subject"),
                "detail": item.get("detail"),
                "context": item.get("context"),
                "source": "solar",
            }
        )

    # 6) 같은 용어 쌍(term_mismatch)은 한 건으로 합친다
    out_violations = _merge_same_term_mismatch(out_violations, manuscript_text)

    summary = {
        "total_found": len(conflicts),
        "after_dedup": len(out_violations),
        "dropped_rule_dup": len(dropped_dup),
        "invalid_evidence": len(invalid_evidence_items),
    }

    dropped = [
        {"reason": "invalid_evidence", "item": it} for it in invalid_evidence_items
    ] + [
        {"reason": "rule_duplicate", "item": d["item"], "matched_rule": d["matched_rule"]}
        for d in dropped_dup
    ]

    return (
        {
            "summary": summary,
            "violations": out_violations,
            "dropped": dropped,
            "errors": [],
        },
        [],
        out_violations,
        dropped,
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
        rule_findings = body.get("rule_findings")

        if not isinstance(settings_text, str) or not settings_text.strip():
            _fail(self, "settings_text(설정집 텍스트)가 필요합니다")
            return
        if not isinstance(manuscript_text, str) or not manuscript_text.strip():
            _fail(self, "manuscript_text(원고 텍스트)가 필요합니다")
            return
        if not isinstance(rule_findings, dict):
            _fail(self, "rule_findings(규칙 결과 JSON)가 필요합니다")
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

        result, errors, _, _ = _process(
            settings_text, manuscript_text, rule_findings, api_key
        )

        if errors:
            result["errors"] = errors

        _send_json(self, result)

    def log_message(self, format, *args):
        # Vercel 로그와 충돌하지 않도록 기본 로그 억제
        pass
