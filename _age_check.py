import re

with open('test/manuscript.txt', encoding='utf-8-sig') as f:
    text = f.read()

names = ["유진혁", "진혁"]
KOR_TENS = {"열":10,"스물":20,"서른":30,"마흔":40,"쉰":50,"예순":60,"일흔":70,"여든":80,"아흔":90}
KOR_ONES = {"한":1,"두":2,"세":3,"네":4,"다섯":5,"여섯":6,"일곱":7,"여덟":8,"아홉":9}

def korean_age_to_int(token):
    token = token.replace("스무","스물")
    for tens, tens_value in KOR_TENS.items():
        if token.startswith(tens):
            rest = token[len(tens):]
            if rest == "":
                return tens_value
            if rest in KOR_ONES:
                return tens_value + KOR_ONES[rest]
            return None
    return None

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 요청 표현 검색
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
targets = [
    "스무 살",
    "스무 살이었다",
    "17살",
    "17살이었다",
    "20세",
    "20세였다",
    "열입곱 살",
    "열입골 살이었다",
    "스물세 살",
    "19세기",
    "5세대",
]

print("=== 요청 표현 검색 결과 ===")
found_any = False
for term in targets:
    positions = [m.start() for m in re.finditer(re.escape(term), text)]
    if not positions:
        continue
    found_any = True
    print(f"\n[{term}] — {len(positions)}회 발견")
    for pos in positions:
        line_no = text.count("\n", 0, pos) + 1
        window = text[max(0,pos-60):pos+20]
        has_name = any(n in window for n in names)
        ctx = text[max(0,pos-30):pos+len(term)+10].replace("\n"," ")
        print(f"  라인 {line_no} / 위치 {pos}")
        print(f"    윈도우(앞60+뒤20): {window!r}")
        print(f"    유진혁 in window: {'유진혁' in window} / 진혁 in window: {'진혁' in window}")
        print(f"    → 인물명 있음? {has_name}")
        print(f"    맥락: ...{ctx}...")

if not found_any:
    print("요청한 표현 중 발견된 것 없음")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 나이 표현으로 인식되는 것 전부 (스크립트 find_ages 기준)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print("\n\n=== find_ages 기준 나이 표현 전부 ===")
ages = []
for m in re.finditer(r"(\d{1,3})\s*(?:살|세|해)(?![가-힣]{2})", text):
    ages.append((int(m.group(1)), m.start(), m.group(0)))
tens_pat = "|".join(sorted(list(KOR_TENS)+["스무"], key=len, reverse=True))
ones_pat = "|".join(KOR_ONES)
for m in re.finditer(rf"({tens_pat})({ones_pat})?\s*(?:살|세|해)(?![가-힣]{{2}})", text):
    raw = re.split(r"\s*(?:살|세|해)", m.group(0))[0].strip()
    val = korean_age_to_int(raw)
    if val is not None:
        ages.append((val, m.start(), m.group(0)))

for val, pos, raw in sorted(ages, key=lambda x: x[1]):
    line_no = text.count("\n", 0, pos)+1
    window = text[max(0,pos-60):pos+20]
    has_name = any(n in window for n in names)
    ctx = text[max(0,pos-25):pos+15].replace("\n"," ")
    print(f"라인 {line_no} / 값={val} / 원문={raw!r} / 위치 {pos}")
    print(f"  윈도우: {window!r}")
    print(f"  인물명 있음? {has_name}  ('유진혁': {'유진혁' in window}, '진혁': {'진혁' in window})")
    print(f"  맥락: ...{ctx}...")
