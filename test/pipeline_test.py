"""
원고 기반 파이프라인 테스트: memory → 마크다운 → 승인/제외 반영.

LLM 호출을 흉내내지 않고, 수동 JSON으로 파이프라인 정상 동작 확인.

유진혁 시나리오:
  - main 버킷: 나이 19(1화) → 20(44화)
  - pre_regression 버킷: 나이 32세 (회귀 전, 유지 대상)

목표:
  - main 마크다운: 나이 20 (최신), 불가 마법 (승인 후)
  - pre_regression 마크다운: 나이 32 (그대로 유지)
  - rejected로 32세를 제외하지 않음 (메모리에서 삭제 없음)
"""

import json
import sys

sys.path.insert(0, "lib")
from memory import memory_to_markdown, apply_approval


def _get_latest_age(data: dict, target_timeline: str, char_name: str):
    for c in data["characters"]:
        if c["name"] == char_name:
            bucket = c["data"].get(target_timeline, {})
            field = bucket.get("age")
            if isinstance(field, list):
                return max(field, key=lambda x: x.get("episode", 0))["value"]
            if isinstance(field, dict):
                return field.get("value")
    return None


# 유진혁: main에 나이 19(1화) → 20(44화), pre_regression에 32세
test_memory = {
    "version": 1,
    "metadata": {
        "story_title": "탑을 클리어한 나는 회귀했다",
        "created_at": "2026-09-12T00:00:00+09:00",
        "last_updated_episode": 44,
    },
    "timelines": [
        {"id": "main", "label": "현재"},
        {"id": "pre_regression", "label": "회귀 전"},
    ],
    "characters": [
        {
            "id": "char_eugene",
            "name": "유진혁",
            "data": {
                "main": {
                    "aliases": [
                        {"value": ["진혁"], "episode": 1, "note": "원문: 진혁아"},
                    ],
                    "age": [
                        {"value": 19, "episode": 1, "note": "원문: 만 19살 성인이 되는 날"},
                        {"value": 20, "episode": 44, "note": "원문: 스무 살 인생에 혹시라도"},
                    ],
                    "affiliation": [
                        {"value": "베나토르", "episode": 1, "note": "원문: 베나토르"},
                    ],
                    "cannot": None,
                    "notes": [
                        {"value": "탑 최초 클리어 후 회귀", "episode": 1, "note": "원문: 탑 최초 클리어"},
                    ],
                },
                "pre_regression": {
                    "aliases": [
                        {"value": ["진혁"], "episode": 1, "note": "원문: 진혁아"},
                    ],
                    "age": [
                        {"value": 32, "episode": 1, "note": "원문: 회귀 전에는 32세였고"},
                    ],
                    "affiliation": [
                        {"value": "베나토르", "episode": 1, "note": "원문: 베나토르"},
                    ],
                    "cannot": None,
                    "notes": [
                        {"value": "회귀 전 상태", "episode": 1, "note": "원문: 회귀 전에는"},
                    ],
                },
            },
            "first_appearance": {"timeline": "main", "episode": 1},
        },
    ],
    "places": [
        {
            "id": "place_gwanghwamun",
            "name": "광화문",
            "data": {
                "main": {
                    "notes": [
                        {"value": "바벨 출현 지점", "episode": 7, "note": "원문: 광화문 앞에 바벨"},
                    ]
                },
                "pre_regression": {
                    "notes": [
                        {"value": "회귀 전에도 광화문", "episode": 1, "note": "원문: 회귀 전 광화문"},
                    ]
                },
            },
        },
    ],
    "timeline": [
        {"id": "tl_01", "label": "수능", "timeline": "main", "mentioned_in_episodes": [1, 3]},
        {"id": "tl_02", "label": "탑 등장", "timeline": "main", "mentioned_in_episodes": []},
        {"id": "tl_03", "label": "튜토리얼", "timeline": "main", "mentioned_in_episodes": [3]},
        {"id": "tl_04", "label": "불심검문", "timeline": "main", "mentioned_in_episodes": [5]},
        {"id": "tl_05", "label": "베나토르 합류", "timeline": "main", "mentioned_in_episodes": []},
        {"id": "tl_06", "label": "수능", "timeline": "pre_regression", "mentioned_in_episodes": [1]},
        {"id": "tl_07", "label": "탑 등장", "timeline": "pre_regression", "mentioned_in_episodes": []},
    ],
}

print("=" * 70)
print("1) 메모리 → 마크다운 (target_timeline='main', 기본값)")
print("-" * 70)
md_main = memory_to_markdown(test_memory)
print(md_main)

print("=" * 70)
print("2) 메모리 → 마크다운 (target_timeline='pre_regression')")
print("-" * 70)
md_pre = memory_to_markdown(test_memory, target_timeline="pre_regression")
print(md_pre)

print("=" * 70)
print("3) 승인 적용 (main 버킷에만: cannot ['마법'] 추가)")
print("-" * 70)
approved = [
    {
        "type": "character",
        "id": "char_eugene",
        "name": "유진혁",
        "field": "cannot",
        "value": ["마법"],
        "episode": 1,
        "note": "원문: 마법은 불가 설정",
    },
]
updated = apply_approval(test_memory, approved, [], target_timeline="main")

print("--- updated memory (JSON, 핵심만) ---")
print(json.dumps(updated, ensure_ascii=False, indent=2))

print("--- updated main 마크다운 ---")
print(memory_to_markdown(updated, target_timeline="main"))

print("--- updated pre_regression 마크다운 (32세 그대로 유지 확인) ---")
print(memory_to_markdown(updated, target_timeline="pre_regression"))

print("=" * 70)
print("4) 회귀 전 값(32세)이 메모리에서 삭제되지 않았는지 확인")
print("-" * 70)
pre_age = _get_latest_age(updated, "pre_regression", "유진혁")
main_age = _get_latest_age(updated, "main", "유진혁")
print(f"pre_regression 유진혁 나이 (메모리 내부): {pre_age}")
print(f"main 유진혁 나이 (메모리 내부): {main_age}")
assert pre_age == 32, f"회귀 전 32세가 사라짐: {pre_age}"
assert main_age == 20, f"main 최신값 아님: {main_age}"
print("→ 회귀 전 32세 유지, main 최신 20세 확인")

print("=" * 70)
print("5) rejected로 32세를 전달해도 excluded에만 기록되고 메모리는 유지")
print("-" * 70)
rejected = [
    {
        "type": "character",
        "id": "char_eugene",
        "name": "유진혁",
        "field": "age",
        "value": 32,
        "episode": 1,
        "note": "회귀 전 32세",
        "reason": "검토 대상 아님 — 회귀 전 값이므로 메모리는 유지",
    },
]
updated2 = apply_approval(updated, [], rejected, target_timeline="main")
pre_age2 = _get_latest_age(updated2, "pre_regression", "유진혁")
print(f"rejected 전달 후 pre_regression 유진혁 나이 (메모리 내부): {pre_age2}")
assert pre_age2 == 32, f"rejected로 32세가 사라짐: {pre_age2}"
print("→ rejected가 들어와도 사전 데이터는 삭제되지 않음")
print(f"    excluded.characters 기록: {json.dumps(updated2['excluded']['characters'], ensure_ascii=False, indent=2)}")

print("=" * 70)
print("파이프라인 정상 동작 확인 완료")
