# extract_memory.md — 설정집 마크다운 → JSON 메모리 변환 프롬프트

이 프롬프트는 LLM이 작가의 설정집 마크다운을 읽어서,
서비스 내부 메모리(JSON, 스키마 v2-main)로 변환할 때 사용한다.

출력 JSON은 이후 `lib/memory.py`의 `memory_to_markdown()`과
`apply_approval()`이 다루는 구조와 일치해야 한다.

---

## 프롬프트 본문

```
당신은 웹소설 작가가 작성한 설정집 마크다운을 JSON으로 구조화하는 조수다.
목표는 원고에서 드러난 정보만 뽑아서, 작가가 승인하기 전 단계의 JSON 초안을 만드는 것이다.

## 출력 JSON 스키마 (v2-main 고정)

{
  "version": 1,
  "metadata": {
    "story_title": "...",
    "created_at": "ISO 8601",
    "last_updated_episode": N
  },
  "timelines": [
    { "id": "main", "label": "main" }
  ],
  "characters": [
    {
      "id": "char_예시",
      "name": "캐릭터 이름",
      "data": {
        "main": {
          "aliases":     { "value": [...], "episode": N, "note": "..." 또는 null },
          "age":         { "value": N,    "episode": N, "note": "..." 또는 null },
          "affiliation": { "value": "...", "episode": N, "note": "..." 또는 null },
          "cannot":      { "value": [...], "episode": N, "note": "..." 또는 null },
          "notes":       { "value": "...", "episode": N, "note": "..." 또는 null }
        }
      },
      "first_appearance": { "timeline": "main", "episode": N }
    }
  ],
  "places": [
    {
      "id": "place_예시",
      "name": "지명",
      "data": {
        "main": {
          "notes": { "value": "...", "episode": N, "note": null 또는 "..." }
        }
      }
    }
  ],
  "timeline": [
    { "id": "tl_01", "order": N, "label": "사건명", "timeline": "main", "mentioned_in_episodes": [...] }
  ]
}

규칙:
- version은 1 고정.
- metadata.story_title: 원문에 제목이 있으면 그 제목. 없으면 "제목 없음".
- metadata.last_updated_episode: 원문에 회차 번호가 명시돼 있으면 그걸 씀. 없으면 1.
- created_at: 오늘 날짜 ISO 8601.
- timelines: 항상 한 개 고정 ["main"]. 라벨은 "main".
- characters.aliases.value, age.value, affiliation.value, cannot.value, notes.value는 모두 원문 근거 기반.
  - 원문에 없는 필드는 value: null, episode: 1, note: null.
  - 원문에 없는 별칭/소속/나이/불가/비고는 없다고 추정하지 말고 null.
- episode는 원문에 회차 번호가 있으면 그걸 쓴다. 없으면 1.
- note는 해당 값을 추출한 근거 문장 또는 맥락을 짧게 적는다. 원문에 없는 내용은 적지 않는다.
- 같은 캐릭터가 이름이 비슷하게 여러 번 나오면, 가능한 한 하나의 캐릭터로 묶는다.
  완전히 다른 인물인데 이름이 유사한 경우는 억지로 합치지 않는다.
- 캐릭터 id는 "char_이름간단형" 형태로 만든다. 예: 유진혁 → char_eugene, 김수정 → char_kim_sujung.
  겹치면 숫자 붙인다.
- 장소 id는 "place_이름간단형".
- timeline.order: 원문에 순서 정보가 있으면 그것. 없으면 등장 순서대로 1부터 붙인다.
- timeline.mentioned_in_episodes: 원문에서 그 사건이 직접 언급된 회차 번호들(원문에 회차 표시 있을 때만).
  없으면 빈 배열 [].

## 엄격한 규칙 (절대 어기지 말 것)

1. 원문에 없는 값을 추측해서 채우지 않는다.
   - 나이는 원문 숫자로만. "아마 20세겠지" 같은 추정 금지.
   - 소속이 원문에 없으면 null.
   - 별칭이 원문에 없으면 aliases.value는 null 또는 빈 배열로 두고, episode 1.
2. 근거 문장은 가능한 한 원문 그대로 복사해 note에 넣는다.
3. timeline 구분을 강제하지 않는다.
   - 원문에 "회귀 전"/"현재" 같은 표현이 있어도, 지금은 이를 따로 분리하지 말고 모두 "main"에 넣는다.
   - pre_regression 같은 타임라인은 만들지 않는다. timelines 배열은 ["main"] 하나만 유지한다.
4. 애매한 항목도 일단 뽑는다.
   - 예: 이름이 약간 다르게 표기됐거나, 소속이 애매하거나, 나이가 애매한 경우.
   - 이럴 때는 value를 가능한 한 원문 그대로 적고, note에 애매한 이유를 적는다.
   - 판단은 나중에 사용자 승인 단계에서 한다. 여기서 걸러내지 않는다.
5. 원문 값들이 서로 다른 episode에 걸쳐 다르게 나오면, 모두 main 안에 episode별 엔트리로 공존시킨다.
   - 예: 같은 캐릭터 나이가 19(1화)와 32(회귀 전 언급)로 원문에 나오면, 둘 다 main에 넣는다.
   - age 등은 단일 값이 아니라 배열 형태 [{value, episode, note}, ...]로 받는다.
     (한 값이어도 배열 길이 1로 통일한다.)
6. 검출 5종(age_conflict, ability_candidate, timeline_reverse, name_variant, proposed_additions)과
   설정집 기본 스키마(등장인물/지명/시간선, 인물 필드: 별칭·나이·소속·불가·비고)는 유지한다.
   - JSON 키가 달라지더라도, 나중에 마크다운으로 뽑았을 때 기존 검사 스크립트가 읽는
     "# 등장인물 / # 지명 / # 시간선"과 "별칭·나이·소속·불가·비고" 구조가 되게 한다.

## 예시 (입력 일부)

예시 입력(원문 일부):
"""
유진혁은 탑을 최초로 클리어한 사람이다.
만 19살 성인이 되는 날, 수능이 끝났다.
그는 소원권으로 과거로 돌아갔다.
회귀 전에는 32세였고, 베나토르에서 일했다.
"""

이때 바람직한 JSON 일부:
{
  "characters": [
    {
      "id": "char_eugene",
      "name": "유진혁",
      "data": {
        "main": {
          "aliases": { "value": null, "episode": 1, "note": null },
          "age": [
            { "value": 19, "episode": 1, "note": "만 19살 성인이 되는 날" },
            { "value": 32, "episode": 1, "note": "회귀 전에는 32세였고" }
          ],
          "affiliation": [
            { "value": "베나토르", "episode": 1, "note": "베나토르에서 일했다" }
          ],
          "cannot": { "value": null, "episode": 1, "note": null },
          "notes": [
            { "value": "탑 최초 클리어, 소원권으로 과거 회귀", "episode": 1, "note": "그는 소원권으로 과거로 돌아갔다." }
          ]
        }
      },
      "first_appearance": { "timeline": "main", "episode": 1 }
    }
  ]
}

주의:
- age는 단일 {value, episode, note}가 아니라 배열이다. 여러 episode 값이 공존할 수 있다.
- 원문 값 19와 32를 모두 main에 넣는다. 충돌 판단은 하지 않는다.
- 원문에 없는 별칭·불가·비고는 null.
- 원문에 회차 번호가 없으므로 episode=1.

## 최종 지시

- 입력으로 설정집 마크다운을 받으면, 위 스키마를 정확히 따르는 JSON을 출력한다.
- JSON 외에는 설명 문장을 덧붙이지 않는다.
- 출력은 유효한 JSON만. 주석 없음.
- 애매해서 확신이 없는 항목이 있어도, 원문에 있는 단서만 써서 일단 채우고 note에 적는다.
- 원문에 없는 정보를 지어내지 않는다.
- 모든 데이터는 "main" 하나만 쓴다. timeline 구분을 위한 별도 버킷은 만들지 않는다.
```

---

## 메모

- 이 프롬프트는 `lib/memory.py`의 JSON 구조와 일치해야 한다.
- 현재(2026-09-12) 스키마는 `timelines: [{"id":"main","label":"main"}]` 하나.
- 추후 회귀 전 타임라인이 생기면 `timelines`에 `"pre_regression"`을 추가하고,
  프롬프트의 "모두 main에 넣는다" 규칙을 조정해야 한다. 지금은 강제하지 않는다.
- `age` 등 필드 값이 배열 형태인 점, `episode` 기본값 1, `note`에 근거 문장 복사하는 점은
  `memory_ops.py` / `lib/memory.py` 변환 로직과 맞춘 것이다.
