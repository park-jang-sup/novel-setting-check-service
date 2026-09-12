"""
solar_extract.py — test/manuscript.txt 를 extract_memory.md 프롬프트로 Solar에 넘겨
JSON 메모리 초안을 받는다.

환경변수:
  HERMES_CUSTOM_UPSTAGE_API_KEY : Upstage API 키
"""

import copy
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta

PROMPT_PATH = "lib/prompts/extract_memory.md"
MANUSCRIPT_PATH = "test/manuscript.txt"
OUT_JSON_PATH = "test/output.json"

SYSTEM = (
    "You are an assistant that outputs only valid JSON matching the schema in the user prompt. "
    "No other text."
)


def read_utf8(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def build_prompt(md_path, manuscript_path):
    prompt_md = read_utf8(md_path)
    manuscript = read_utf8(manuscript_path)
    return prompt_md, manuscript


def _kst_now_iso():
    """실행 시점 KST 날짜 ISO 8601 (00:00:00+09:00)."""
    now = datetime.now(timezone(timedelta(hours=9)))
    return now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


def _manuscript_contains(text, needle):
    """원고에 needle(근거 문장)이 실제 포함되어 있는지 확인한다.

    부분 일치로 검사하며, 공백/개행 차이를 어느 정도 허용한다.
    """
    if not needle:
        return False
    norm_text = re.sub(r"\s+", " ", text)
    norm_needle = re.sub(r"\s+", " ", needle)
    return norm_needle in norm_text


def _validate_evidence(data, manuscript_text):
    """evidence 가 원고에 실제로 없는 엔트리를 제거한다.

    대상:
      - characters[].data.main.{aliases,age,affiliation,cannot,notes}[]
      - places[].data.main.notes[]
      - timeline[].label 은 evidence 규칙이 아님 — 건드리지 않는다.

    반환값:
      - dropped_count: 제거된 엔트리 수
      - dropped_items: 제거된 각 엔트리의 기록 목록
        [{character, field, value, evidence}, ...]
    """
    dropped_count = 0
    dropped_items = []
    manuscript_norm = re.sub(r"\s+", " ", manuscript_text)

    def prune_field(char_name, field_key, field):
        """필드 배열(예: age=[...])에서 evidence 없는 엔트리 제거."""
        nonlocal dropped_count
        if field is None:
            return None
        if isinstance(field, dict):
            # 단일 obj → array 아님. 현재 schema는 배열 기준이므로 드뭄.
            return field
        if isinstance(field, list):
            kept = []
            for entry in field:
                ev = entry.get("evidence")
                if ev is None:
                    # 증거가 null인 항목은 그대로 둔다 (원문에 없는 값일 수 있음)
                    kept.append(entry)
                    continue
                if _manuscript_contains(manuscript_norm, ev):
                    kept.append(entry)
                else:
                    dropped_count += 1
                    dropped_items.append({
                        "character": char_name,
                        "field": field_key,
                        "value": entry.get("value"),
                        "episode": entry.get("episode"),
                        "evidence": ev,
                    })
            return kept if kept else None
        return field

    for c in data.get("characters", []):
        char_name = c.get("name") or c.get("id", "unknown")
        main = c.get("data", {}).get("main", {})
        for key in ("aliases", "age", "affiliation", "cannot", "notes"):
            main[key] = prune_field(char_name, key, main.get(key))

    for p in data.get("places", []):
        place_name = p.get("name") or p.get("id", "unknown")
        main = p.get("data", {}).get("main", {})
        main["notes"] = prune_field(place_name, "notes", main.get("notes"))

    return dropped_count, dropped_items


def call_solar(prompt_text, manuscript_text, api_key):
    url = "https://api.upstage.ai/v1/chat/completions"

    payload = {
        "model": "solar-pro4",
        "messages": [
            {"role": "system", "content": SYSTEM},
            {
                "role": "user",
                "content": prompt_text + "\n\n===== [회차 원고 시작] =====\n\n" + manuscript_text + "\n\n===== [회차 원고 끝] =====",
            },
        ],
        "max_tokens": 4000,
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
    }

    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=req_data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {body}") from e
    except Exception as e:
        raise RuntimeError(f"호출 실패: {e}") from e


def main():
    api_key = os.environ.get("HERMES_CUSTOM_UPSTAGE_API_KEY") or os.environ.get("UPSTAGE_API_KEY")
    if not api_key:
        print("ERROR: UPSTAGE_API_KEY 또는 HERMES_CUSTOM_UPSTAGE_API_KEY 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)

    prompt_text, manuscript_text = build_prompt(PROMPT_PATH, MANUSCRIPT_PATH)

    print(f"프롬프트 길이: {len(prompt_text)} chars")
    print(f"원고 길이: {len(manuscript_text)} chars")

    print("Solar 호출 중... (이 호출은 1회 전체 원고를 프롬프트로 넣는다)")
    resp = call_solar(prompt_text, manuscript_text, api_key)

    choices = resp.get("choices", [])
    if not choices:
        print("응답에 choices가 없습니다:", json.dumps(resp, ensure_ascii=False, indent=2))
        sys.exit(1)

    content = choices[0].get("message", {}).get("content", "")
    print("=== 응답(content) 첫 500자 ===")
    print(content[:500])
    print("=== 응답 전체 길이:", len(content), "chars ===")

    # JSON 파싱 시도
    s = content.strip()
    start = s.find("{")
    end = s.rfind("}")
    if start >= 0 and end > start:
        json_text = s[start:end+1]
        try:
            parsed = json.loads(json_text)
            out = parsed
            print("=== JSON 파싱 성공 ===")
        except json.JSONDecodeError as e:
            print(f"=== JSON 파싱 실패 (잘린 텍스트): {e} ===", file=sys.stderr)
            print("=== 원본 content (전체) ===", file=sys.stderr)
            print(content, file=sys.stderr)
            out = {"raw_content": content, "parse_error": str(e)}
    else:
        print("=== JSON 객체({})를 찾을 수 없습니다 ===", file=sys.stderr)
        print("=== 원본 content ===", file=sys.stderr)
        print(content, file=sys.stderr)
        out = {"raw_content": content, "no_json_object": True}

    # 실행 시점 날짜 주입
    out.setdefault("metadata", {})
    out["metadata"]["created_at"] = _kst_now_iso()

    # evidence 검증: 원고에 실제로 없는 근거 문장 제거
    dropped_count, dropped_items = _validate_evidence(out, manuscript_text)
    print(f"=== evidence 검증: 원고에 없는 근거 {dropped_count}건 제거 ===")
    for item in dropped_items:
        print(
            f"  [제거] character={item['character']} | field={item['field']} | "
            f"value={item['value']} | episode={item['episode']} | "
            f"evidence=\"{item['evidence']}\""
        )

    # 저장
    with open(OUT_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"=== 저장 완료: {OUT_JSON_PATH} ===")

    # 메타데이터 출력
    if isinstance(out, dict):
        print("=== metadata ===")
        print(json.dumps(out.get("metadata", {}), ensure_ascii=False, indent=2))
        print("=== characters 개수:", len(out.get("characters", [])), "===")
        print("=== places 개수:", len(out.get("places", [])), "===")
        print("=== timeline 개수:", len(out.get("timeline", [])), "===")


if __name__ == "__main__":
    main()
