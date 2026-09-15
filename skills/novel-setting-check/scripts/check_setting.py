#!/usr/bin/env python3
"""
check_setting.py — 소설 설정집과 원고를 대조해 설정 오류를 검출한다.

사용:
  python check_setting.py <설정집.md> <원고.txt>

출력: JSON (stdout)

검출 항목:
  age_conflict      나이 모순 (확정 판정)
  ability_candidate 능력 위반 후보 (판단은 사용자 몫)
  timeline_reverse  시간선 역행
  name_variant      표기 흔들림
  proposed_additions 미등록 고유명사 (확인 필요, 오류 아님)
"""

import json
import re
import sys
from difflib import SequenceMatcher

# ─────────────────────── 상수 ───────────────────────
CONTEXT_CHARS = 30          # 검출 지점 앞뒤로 보여줄 글자 수
NAME_SIMILARITY_MIN = 0.8  # 표기 흔들림 판정 최소 유사도 (자모 단위 비교)
MIN_NAME_LEN = 2            # 고유명사 후보 최소 길이
MAX_NAME_LEN = 6            # 고유명사 후보 최대 길이
MIN_OCCURRENCE = 2          # 미등록 이름으로 제안할 최소 등장 횟수
MAX_SAME_KIND = 5           # 같은 종류 오류를 최대 몇 건까지 나열할지
AGE_WINDOW_BEFORE = 60      # 나이 표현 앞쪽에서 인물명을 찾을 범위
AGE_WINDOW_AFTER = 20
ABILITY_WINDOW = 80         # 능력 키워드 주변에서 인물명을 찾을 범위

# 한글 수사 → 숫자 (나이 표현용)
KOR_TENS = {
    "열": 10, "스물": 20, "서른": 30, "마흔": 40, "쉰": 50,
    "예순": 60, "일흔": 70, "여든": 80, "아흔": 90,
}
KOR_ONES = {
    "한": 1, "두": 2, "세": 3, "네": 4, "다섯": 5,
    "여섯": 6, "일곱": 7, "여덟": 8, "아홉": 9,
}

SECTION_ALIASES = {
    "등장인물": "characters",
    "인물": "characters",
    "지명": "places",
    "장소": "places",
    "세계관": "places",
    "시간선": "timeline",
    "연표": "timeline",
}

FIELD_ALIASES = {
    "별칭": "aliases",
    "나이": "age",
    "소속": "affiliation",
    "불가": "cannot",
    "비고": "note",
}

# 고유명사 후보에서 제외할 일반어 (조사·어미가 붙은 형태까지)
STOPWORDS = {
    "그것", "이것", "저것", "여기", "거기", "저기", "우리", "너희",
    "그들", "자신", "모두", "다시", "이제", "아직", "그리고", "하지만",
    "그러나", "그래서", "때문", "그때", "지금", "오늘", "내일", "어제",
    "사람", "이름", "얼굴", "목소리", "생각", "마음", "순간", "시간",
    "이상", "정도", "동안", "이후", "이전", "앞으로", "조용히", "천천히",
    "아씨", "나리", "어르신", "마님", "도련님", "어머니", "아버지",
    "무엇", "누구", "어디", "언제", "처음", "마지막", "아무", "여전히",
}


def fail(msg):
    """치명 오류: JSON 오류 응답을 stdout에 출력 후 exit(1)."""
    out = {
        "summary": None,
        "violations": [],
        "proposed_additions": [],
        "not_checked": [],
        "errors": [msg],
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    sys.exit(1)


def read_text(path, label):
    try:
        with open(path, encoding="utf-8-sig") as fh:
            return fh.read()
    except FileNotFoundError:
        fail(f"파일 없음: {label} ({path})")
    except UnicodeDecodeError:
        fail(f"인코딩 오류: {label}은 UTF-8로 저장해야 합니다 ({path})")


# ─────────────────────── 설정집 파싱 ───────────────────────
def parse_ledger(text):
    """마크다운 설정집을 dict로 변환."""
    characters = []
    places = []
    timeline = []

    section = None
    current = None

    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue

        if line.startswith("## "):
            if section == "characters":
                current = {
                    "name": line[3:].strip(),
                    "aliases": [],
                    "age": None,
                    "cannot": [],
                }
                characters.append(current)
            continue

        if line.startswith("# "):
            key = line[2:].strip()
            section = SECTION_ALIASES.get(key)
            current = None
            if section is None:
                fail(f"알 수 없는 섹션: '{key}' "
                     "(등장인물 / 지명 / 시간선 중 하나여야 합니다)")
            continue

        if section == "characters" and current is not None:
            m = re.match(r"^\s*-\s*([^:]+):\s*(.+)$", line)
            if not m:
                continue
            field = FIELD_ALIASES.get(m.group(1).strip())
            value = m.group(2).strip()
            if field == "aliases":
                current["aliases"] = [v.strip() for v in value.split(",") if v.strip()]
            elif field == "age":
                if not value.isdigit():
                    fail(f"나이는 숫자여야 합니다: {current['name']} = '{value}'")
                current["age"] = int(value)
            elif field == "cannot":
                current["cannot"] = [v.strip() for v in value.split(",") if v.strip()]

        elif section == "places":
            m = re.match(r"^\s*-\s*(.+)$", line)
            if m:
                places.append(m.group(1).strip())

        elif section == "timeline":
            m = re.match(r"^\s*(\d+)\.\s*(.+)$", line)
            if m:
                timeline.append({"order": int(m.group(1)),
                                 "label": m.group(2).strip()})

    if not characters and not places and not timeline:
        fail("설정집이 비어 있거나 형식이 맞지 않습니다 "
             "(# 등장인물 / # 지명 / # 시간선 섹션이 필요합니다)")

    return {"characters": characters, "places": places, "timeline": timeline}


# ─────────────────────── 나이 표현 ───────────────────────
def korean_age_to_int(token):
    """'스무'·'스물세' 같은 표현을 숫자로. 실패하면 None."""
    token = token.replace("스무", "스물")
    for tens, tens_value in KOR_TENS.items():
        if token.startswith(tens):
            rest = token[len(tens):]
            if rest == "":
                return tens_value
            if rest in KOR_ONES:
                return tens_value + KOR_ONES[rest]
            return None
    return None


def find_ages(text):
    """본문에서 나이 표현을 찾아 [(숫자, 위치)] 반환."""
    found = []
    # ① 숫자 + 살/세/해
    for m in re.finditer(r"(\d{1,3})\s*(?:살|세|해)", text):
        nxt = text[m.end():]
        if nxt.startswith(("기", "대")):
            continue  # 19세기, 5세대 등 차단
        found.append((int(m.group(1)), m.start()))

    tens = "|".join(sorted(list(KOR_TENS) + ["스무"], key=len, reverse=True))
    ones = "|".join(KOR_ONES)

    # ② 한글 수사(십 단위 + 선택적 일의 자리) + 살/세/해
    for m in re.finditer(rf"({tens})({ones})?\s*(?:살|세|해)", text):
        raw_tens = m.group(1) or ""
        raw_ones = m.group(2) or ""
        raw = raw_tens + raw_ones
        nxt = text[m.end():]
        if nxt.startswith(("기", "대")):
            continue  # 19세기, 5세대 등 차단
        value = korean_age_to_int(raw)
        if value is not None:
            found.append((value, m.start()))

    # ③ 십 단위 한글 수사 + 근처 '나이'(조사 포함), 10자 안 — 살 없어도 인정
    # 단독 일의 자리(한·두·세·네·…)는 수사 후보에서 제외한다.
    tens_only = rf"({tens})({ones})?"
    for m in re.finditer(tens_only, text):
        raw_tens = m.group(1) or ""
        raw_ones = m.group(2) or ""
        raw = raw_tens + raw_ones
        if not raw_tens:            # 단독 일의 자리 → 스킵
            continue
        value = korean_age_to_int(raw)
        if value is None:
            continue
        pos = m.start()
        nxt = text[m.end():]
        if nxt.startswith(("기", "대")):
            continue                # 19세기, 5세대 등 차단
        if m.end() < len(text) and text[m.end()].isdigit():
            continue                # 더 큰 숫자의 일부면 스킵
        win_start = max(0, pos - 10)
        win_end = min(len(text), m.end() + 10)
        win = text[win_start:win_end]
        for n in re.finditer(r"(?<![가-힣])나이", win):
            nai_start = win_start + n.start()
            rest = text[nai_start + 2:]   # '나이' 뒤
            if rest:
                josa_m = re.match(r"[가-힣]{1,2}", rest)
                if josa_m:
                    josa = josa_m.group(0)
                    # 조사는 확인만 하고 필수는 아님
            found.append((value, pos))
            break

    # 위치(수사 시작) 기준 중복 제거 — 같은 자리 중복을 하나로
    seen = set()
    deduped = []
    for val, pos in found:
        if pos in seen:
            continue
        seen.add(pos)
        deduped.append((val, pos))
    return deduped


# ─────────────────────── 유틸 ───────────────────────
def josa_i(word):
    """받침 유무에 따라 '이' 또는 '가'를 고른다."""
    if not word:
        return "가"
    last = word[-1]
    if "가" <= last <= "힣":
        return "이" if (ord(last) - 0xAC00) % 28 else "가"
    return "가"


def line_of(text, pos):
    return text.count("\n", 0, pos) + 1


def context_of(text, pos, length):
    start = max(0, pos - CONTEXT_CHARS)
    end = min(len(text), pos + length + CONTEXT_CHARS)
    return text[start:end].replace("\n", " ").strip()


JAMO_CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
JAMO_JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
JAMO_JONG = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"


def to_jamo(s):
    """한글을 자모로 분해한다. '쥐'와 '지'처럼 한 글자 안에서
    어긋나는 오타를 글자 단위 비교로는 잡을 수 없기 때문이다."""
    out = []
    for ch in s:
        if "가" <= ch <= "힣":
            code = ord(ch) - 0xAC00
            out.append(JAMO_CHO[code // 588])
            out.append(JAMO_JUNG[(code % 588) // 28])
            jong = JAMO_JONG[code % 28]
            if jong != " ":
                out.append(jong)
        else:
            out.append(ch)
    return "".join(out)


def similarity(a, b):
    """두 이름의 유사도 (0.0 ~ 1.0).

    글자 집합이 아니라 순서를 고려해 비교한다.
    '아리에르'와 '아리엘'처럼 앞부분이 같고 뒤가 어긋나는
    한글 표기 흔들림을 잡기 위해서다.
    """
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, to_jamo(a), to_jamo(b)).ratio()


def nearest_known(name, known):
    """등록명 중 가장 유사한 것을 반환. 임계값 미만이면 None."""
    best, best_score = None, 0.0
    for candidate in known:
        if name == candidate:
            continue
        score = similarity(name, candidate)
        if score > best_score:
            best, best_score = candidate, score
    return best if best_score >= NAME_SIMILARITY_MIN else None


def all_names(ledger):
    names = []
    seen = set()
    for c in ledger["characters"]:
        if c["name"] not in seen:
            names.append(c["name"])
            seen.add(c["name"])
        for alias in c["aliases"]:
            if alias not in seen:
                names.append(alias)
                seen.add(alias)
    for p in ledger["places"]:
        if p not in seen:
            names.append(p)
            seen.add(p)
    return names


# ─────────────────────── 검사 ───────────────────────
def check_age(text, ledger, violations):
    """설정집 나이와 본문 나이 표현의 모순을 찾는다."""
    ages = find_ages(text)
    if not ages:
        return
    for c in ledger["characters"]:
        if c["age"] is None:
            continue
        labels = [c["name"]] + c["aliases"]
        for value, pos in ages:
            if value == c["age"]:
                continue
            window = text[max(0, pos - AGE_WINDOW_BEFORE):pos + AGE_WINDOW_AFTER]
            if any(label in window for label in labels):
                violations.append({
                    "type": "age_conflict",
                    "severity": "high",
                    "line": line_of(text, pos),
                    "subject": c["name"],
                    "detail": f"설정집 {c['age']}세, 본문 {value}세",
                    "context": context_of(text, pos, 6),
                })


def check_ability(text, ledger, violations):
    """'불가' 설정 키워드가 인물 근처에 등장하는지 후보를 찾는다."""
    for c in ledger["characters"]:
        labels = [c["name"]] + c["aliases"]
        for banned in c["cannot"]:
            keyword = banned.split()[0]
            for m in re.finditer(re.escape(keyword), text):
                window = text[max(0, m.start() - ABILITY_WINDOW):
                              m.start() + ABILITY_WINDOW]
                if any(label in window for label in labels):
                    violations.append({
                        "type": "ability_candidate",
                        "severity": "medium",
                        "line": line_of(text, m.start()),
                        "subject": c["name"],
                        "detail": f"'{banned}' 불가 설정인데 "
                                  f"'{keyword}'{josa_i(keyword)} 근처에 등장합니다",
                        "context": context_of(text, m.start(), len(keyword)),
                    })
                    break


def check_timeline(text, ledger, violations, not_checked):
    """설정집 순번과 본문 등장 순서가 어긋나는지 확인한다."""
    events = [e for e in ledger["timeline"] if e["label"] in text]
    if len(events) < 2:
        not_checked.append("timeline")
        return
    appeared = sorted(events, key=lambda e: text.find(e["label"]))
    for i in range(len(appeared) - 1):
        earlier, later = appeared[i], appeared[i + 1]
        if earlier["order"] > later["order"]:
            pos = text.find(later["label"])
            violations.append({
                "type": "timeline_reverse",
                "severity": "medium",
                "line": line_of(text, pos),
                "subject": later["label"],
                "detail": f"'{earlier['label']}'(순번 {earlier['order']}) 뒤에 "
                          f"'{later['label']}'(순번 {later['order']})"
                          f"{josa_i(later['label'])} 나옵니다",
                "context": context_of(text, pos, len(later["label"])),
            })


def find_proper_nouns(text):
    """한글 고유명사 후보를 추출한다 (조사 제거)."""
    josa = (r"(?:은|는|이|가|을|를|의|에게|에서|에|와|과|으로|로|도|만|께|한테|"
            r"이라는|라는|이라고|라고|야|아|께서|처럼|보다|부터|까지|마다|"
            r"였다|이었다|이다|라며|이라며)")
    strip_josa = re.compile(rf"{josa}$")
    candidates = {}
    # 앞쪽 경계도 본다. 따옴표 바로 뒤에 오는 이름("콩지야.")이
    # 뒤쪽 조건만으로는 잡히지 않기 때문이다.
    pattern = (rf"(?:(?<=^)|(?<=[\s,.\"'!?…\u201c\u201d\u2018\u2019]))"
               rf"([가-힣]{{{MIN_NAME_LEN},{MAX_NAME_LEN + 4}}})"
               rf"(?=\s|[,.\"'!?…\u201c\u201d\u2018\u2019]|$)")
    for m in re.finditer(pattern, text, re.MULTILINE):
        name = strip_josa.sub("", m.group(1))
        if len(name) < MIN_NAME_LEN or len(name) > MAX_NAME_LEN:
            continue
        if name in STOPWORDS:
            continue
        # 동사·형용사 어간 조각을 이름으로 제안하지 않는다
        if re.search(r"(고|지|서|며|면|나|도|만|어|아|워)$", name) and len(name) <= 3:
            continue
        # 한글 고유명사는 서술어 어미로 끝나지 않는다
        if name.endswith(("다", "요", "죠", "까")):
            continue
        candidates.setdefault(name, m.start())
    return candidates


def check_names(text, ledger, violations, proposed):
    """등록명과 유사한 표기 흔들림, 미등록 고유명사를 찾는다."""
    known = all_names(ledger)
    candidates = find_proper_nouns(text)

    for name, pos in candidates.items():
        if name in known:
            continue
        if any(name in k for k in known):
            continue
        # 등록명에 조사·어미가 붙은 형태는 표기 흔들림이 아니다
        if any(k in name for k in known):
            continue

        count = len(re.findall(re.escape(name), text))

        nearest = nearest_known(name, known)

        # 표기 흔들림은 1회만 나와도 검출한다 (오타는 원래 드물게 나온다).
        # 등장 횟수 조건은 미등록 이름 제안에만 적용한다.
        if nearest is None and count < MIN_OCCURRENCE:
            continue

        if nearest:
            violations.append({
                "type": "name_variant",
                "severity": "medium",
                "line": line_of(text, pos),
                "subject": name,
                "detail": f"등록명 '{nearest}'와 유사한 표기입니다",
                "context": context_of(text, pos, len(name)),
            })
        else:
            proposed.append({
                "name": name,
                "count": count,
                "first_line": line_of(text, pos),
                "context": context_of(text, pos, len(name)),
                "note": "설정집에 없는 이름입니다. "
                        "새 인물·지명이면 설정집에 추가하세요.",
            })


# ─────────────────────── 메인 ───────────────────────
def main():
    if len(sys.argv) < 3:
        fail("사용법: python check_setting.py <설정집.md> <원고.txt>")

    ledger_text = read_text(sys.argv[1], "설정집")
    manuscript = read_text(sys.argv[2], "원고")

    if not manuscript.strip():
        fail("원고가 비어 있습니다")

    ledger = parse_ledger(ledger_text)

    violations = []
    proposed = []
    not_checked = []

    check_age(manuscript, ledger, violations)
    check_ability(manuscript, ledger, violations)
    check_timeline(manuscript, ledger, violations, not_checked)
    check_names(manuscript, ledger, violations, proposed)

    if not any(c["age"] is not None for c in ledger["characters"]):
        not_checked.append("age")
    if not any(c["cannot"] for c in ledger["characters"]):
        not_checked.append("ability")

    severity_order = {"high": 0, "medium": 1, "low": 2}
    violations.sort(key=lambda v: (severity_order.get(v["severity"], 3), v["line"]))

    # 같은 오류가 반복되면 앞의 몇 건만 남기고 나머지는 건수로 요약한다.
    # 같은 내용이 수십 건 나열되면 정작 다른 오류가 묻히기 때문이다.
    found_total = len(violations)
    found_high = sum(1 for v in violations if v["severity"] == "high")
    found_medium = sum(1 for v in violations if v["severity"] == "medium")

    totals = {}
    for v in violations:
        key = (v["type"], v["subject"], v["detail"])
        totals[key] = totals.get(key, 0) + 1

    kept, shown = [], {}
    for v in violations:
        key = (v["type"], v["subject"], v["detail"])
        shown[key] = shown.get(key, 0) + 1
        if shown[key] > MAX_SAME_KIND:
            continue
        if shown[key] == 1 and totals[key] > MAX_SAME_KIND:
            v["repeated"] = totals[key]
        kept.append(v)

    omitted = len(violations) - len(kept)
    violations = kept
    proposed.sort(key=lambda p: -p["count"])

    out = {
        "summary": {
            "total": found_total,
            "high": found_high,
            "medium": found_medium,
            "listed": len(violations),
            "omitted_duplicates": omitted,
            "proposed": len(proposed),
            "manuscript_chars": len(manuscript),
        },
        "violations": violations,
        "proposed_additions": proposed,
        "not_checked": not_checked,
        "errors": [],
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
