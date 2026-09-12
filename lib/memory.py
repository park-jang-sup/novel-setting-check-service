"""
lib/memory.py — 설정집 JSON 메모리와 마크다운 변환, 승인/제외 반영.

데이터 구조 (timeline-aware):
{
  "version": 1,
  "metadata": {...},
  "timelines": [{"id": "main", "label": "현재"}, {"id": "pre_regression", "label": "회귀 전"}],
  "characters": [
    {
      "id": "...",
      "name": "...",
      "data": {
        "main": {"aliases": [...], "age": [...], ...},
        "pre_regression": {...}
      },
      "first_appearance": {"timeline": "...", "episode": N}
    }
  ],
  "places": [{"id": "...", "name": "...", "data": {"main": {...}}}],
  "timeline": [
    {"id": "...", "label": "...", "timeline": "main", "mentioned_in_episodes": [...]},
    {"id": "...", "label": "...", "timeline": "pre_regression", ...}
  ]
}

함수:
  memory_to_markdown(data, target_timeline="main") -> str
    target_timeline 버킷의 episode 기준 최신값만 뽑아
    PRD 마크다운 형식(# 등장인물 / # 지명 / # 시간선,
    인물 필드: 별칭·나이·소속·불가·비고)으로 변환.

  apply_approval(data, approved, rejected, *, target_timeline="main") -> dict
    - approved: target_timeline 버킷에 merge (기존 값에 추가/갱신).
    - rejected: 메모리에 남기고, 제외 기록만 excluded에 보관.
      regression 전 값 등 버릴 값이 아니므로 삭제하지 않는다.
"""

from __future__ import annotations

import copy
import re
from typing import Any, Dict, List, Optional


# ─────────────────────── helpers ───────────────────────

def _slug(name: str) -> str:
    """이름을 id 슬러그로 만든다."""
    s = name.lower()
    s = re.sub(r"[^a-z0-9가-힣]", "", s)
    return s[:40] or "unknown"


def _latest_from_bucket(bucket: Dict[str, Any], field_key: str) -> Any:
    """bucket[field_key]의 episode 기준 최신 value 반환.

    field는 다음 형태 중 하나:
      - None
      - {"value": ..., "episode": N, "note": ...}
      - [{"value": ..., "episode": N, "note": ...}, ...]
    """
    field = bucket.get(field_key)
    if field is None:
        return None
    if isinstance(field, dict):
        return field.get("value")
    if isinstance(field, list):
        if not field:
            return None
        latest = max(field, key=lambda x: x.get("episode", 0))
        return latest.get("value")
    return None


def _fmt_list(val: Any) -> Optional[str]:
    if val is None:
        return None
    if isinstance(val, list):
        return ", ".join(str(x) for x in val if x is not None)
    if isinstance(val, str):
        return val
    return None


def _fmt_scalar(val: Any) -> Optional[str]:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, str):
        return val
    return None


# ─────────────────────── 마크다운 변환 ───────────────────────

def memory_to_markdown(data: Dict[str, Any], target_timeline: str = "main") -> str:
    """target_timeline 버킷의 최신값만 뽑아 PRD 마크다운으로 변환.

    # 등장인물 / # 지명 / # 시간선 섹션, 인물 필드:
    별칭·나이·소속·불가·비고.
    """

    characters: List[Dict[str, Any]] = data.get("characters", [])
    places: List[Dict[str, Any]] = data.get("places", [])
    timeline_events: List[Dict[str, Any]] = data.get("timeline", [])

    tl_events = [e for e in timeline_events if e.get("timeline") == target_timeline]

    lines: List[str] = []

    # ── # 등장인물 ──
    lines.append("# 등장인물")
    lines.append("")
    for c in characters:
        name = c.get("name") or "알 수 없음"
        bucket = c.get("data", {}).get(target_timeline, {})

        aliases_val = _latest_from_bucket(bucket, "aliases")
        age_val = _latest_from_bucket(bucket, "age")
        affiliation_val = _latest_from_bucket(bucket, "affiliation")
        cannot_val = _latest_from_bucket(bucket, "cannot")
        notes_val = _latest_from_bucket(bucket, "notes")

        lines.append(f"## {name}")
        lines.append(f"- 별칭: {_fmt_list(aliases_val) or '확인 불가'}")
        lines.append(f"- 나이: {_fmt_scalar(age_val) or '확인 불가'}")
        lines.append(f"- 소속: {_fmt_scalar(affiliation_val) or '확인 불가'}")
        lines.append(f"- 불가: {_fmt_list(cannot_val) or '확인 불가'}")
        lines.append(f"- 비고: {_fmt_scalar(notes_val) or '확인 불가'}")
        lines.append("")

    # ── # 지명 ──
    lines.append("# 지명")
    lines.append("")
    for p in places:
        pname = p.get("name") or "알 수 없음"
        bucket = p.get("data", {}).get(target_timeline, {})
        notes_val = _latest_from_bucket(bucket, "notes")
        if notes_val:
            lines.append(f"- {pname} ({notes_val})")
        else:
            lines.append(f"- {pname}")
    lines.append("")

    # ── # 시간선 ──
    lines.append("# 시간선")
    lines.append("")
    if tl_events:
        for i, tl in enumerate(tl_events, 1):
            label = tl.get("label") or "사건명"
            lines.append(f"{i}. {label}")
    else:
        lines.append("(시간선 항목이 없습니다)")
    lines.append("")

    return "\n".join(lines)


# ─────────────────────── 승인/제외 반영 ───────────────────────

def apply_approval(
    data: Dict[str, Any],
    approved: List[Dict[str, Any]],
    rejected: List[Dict[str, Any]],
    *,
    target_timeline: str = "main",
) -> Dict[str, Any]:
    """승인/제외 반영 후 새 메모리 JSON을 반환.

    - approved 항목: target_timeline 버킷에 merge.
    - rejected 항목: 메모리에서 삭제하지 않고 excluded에 기록.
      (회귀 전 값 등 버릴 값이 아닌 경우 제외 대상으로 넣지 않는 용도.)

    반환 JSON은 copy된 새 객체이며, "excluded" 키가 추가된다.
    """

    new_data: Dict[str, Any] = copy.deepcopy(data)

    excluded: Dict[str, List[Dict[str, Any]]] = {
        "characters": [],
        "places": [],
        "timeline": [],
    }

    for item in rejected:
        excluded = _add_excluded(excluded, item)

    for item in approved:
        new_data = _apply_approved(new_data, item, target_timeline)

    new_data["excluded"] = excluded
    return new_data


def _add_excluded(
    excluded: Dict[str, List[Dict[str, Any]]],
    item: Dict[str, Any],
) -> Dict[str, List[Dict[str, Any]]]:
    typ = item.get("type", "character")
    key: str = (
        "timeline"
        if typ == "timeline"
        else (typ + "s" if typ in ("character", "place") else "characters")
    )

    excluded[key].append({
        "type": typ,
        "id": item.get("id"),
        "name": item.get("name"),
        "field": item.get("field"),
        "value": item.get("value"),
        "episode": item.get("episode", 1),
        "note": item.get("note"),
        "reason": item.get("reason", "사용자가 제외함"),
    })
    return excluded


def _apply_approved(
    data: Dict[str, Any],
    item: Dict[str, Any],
    target_timeline: str,
) -> Dict[str, Any]:
    typ = item.get("type", "character")
    field = item.get("field")
    value = item.get("value")
    episode = item.get("episode", 1)
    note = item.get("note")
    name = item.get("name")

    if typ == "character":
        target = _find_character(data["characters"], item.get("id"), name)
        if target is None:
            target = _new_character(item)
            data["characters"].append(target)
        bucket = target.setdefault("data", {}).setdefault(target_timeline, {})
        _merge_char_field(bucket, field, value, episode, note)
        return data

    if typ == "place":
        target = _find_place(data["places"], item.get("id"), name)
        if target is None:
            target = _new_place(item)
            data["places"].append(target)
        bucket = target.setdefault("data", {}).setdefault(target_timeline, {})
        _merge_place_field(bucket, field, value, episode, note)
        return data

    if typ == "timeline":
        target = _find_timeline(data["timeline"], item.get("id"), name, target_timeline)
        if target is None:
            target = _new_timeline(item, target_timeline)
            data["timeline"].append(target)
        _merge_timeline_field(target, field, value, episode, note)
        return data

    return data


# ─────────────────────── 캐릭터 ───────────────────────

def _find_character(
    characters: List[Dict[str, Any]],
    cid: Optional[str],
    name: Optional[str],
) -> Optional[Dict[str, Any]]:
    for c in characters:
        if cid and c.get("id") == cid:
            return c
        if name and c.get("name") == name:
            return c
    return None


def _new_character(item: Dict[str, Any]) -> Dict[str, Any]:
    name = item.get("name") or "알 수 없음"
    episode = item.get("episode", 1)
    return {
        "id": item.get("id") or f"char_{_slug(name)}",
        "name": name,
        "data": {},
        "first_appearance": {"timeline": "main", "episode": episode},
    }


def _merge_char_field(
    bucket: Dict[str, Any],
    field: str,
    value: Any,
    episode: int,
    note: Optional[str],
) -> None:
    if field not in bucket or bucket[field] is None:
        bucket[field] = _make_entry(value, episode, note)
        return

    existing = bucket[field]
    if isinstance(existing, dict):
        bucket[field] = [
            _make_entry(existing.get("value"), existing.get("episode", 1), existing.get("note")),
            _make_entry(value, episode, note),
        ]
    elif isinstance(existing, list):
        updated = False
        for e in existing:
            if e.get("episode") == episode and e.get("value") == value:
                e["note"] = note or e.get("note")
                updated = True
                break
        if not updated:
            existing.append(_make_entry(value, episode, note))
        bucket[field] = existing
    else:
        bucket[field] = _make_entry(value, episode, note)


# ─────────────────────── 지명 ───────────────────────

def _find_place(
    places: List[Dict[str, Any]],
    pid: Optional[str],
    name: Optional[str],
) -> Optional[Dict[str, Any]]:
    for p in places:
        if pid and p.get("id") == pid:
            return p
        if name and p.get("name") == name:
            return p
    return None


def _new_place(item: Dict[str, Any]) -> Dict[str, Any]:
    name = item.get("name") or "알 수 없음"
    episode = item.get("episode", 1)
    return {
        "id": item.get("id") or f"place_{_slug(name)}",
        "name": name,
        "data": {},
    }


def _merge_place_field(
    bucket: Dict[str, Any],
    field: str,
    value: Any,
    episode: int,
    note: Optional[str],
) -> None:
    if field not in bucket or bucket[field] is None:
        bucket[field] = _make_entry(value, episode, note)
        return

    existing = bucket[field]
    if isinstance(existing, dict):
        bucket[field] = [
            _make_entry(existing.get("value"), existing.get("episode", 1), existing.get("note")),
            _make_entry(value, episode, note),
        ]
    elif isinstance(existing, list):
        updated = False
        for e in existing:
            if e.get("episode") == episode and e.get("value") == value:
                e["note"] = note or e.get("note")
                updated = True
                break
        if not updated:
            existing.append(_make_entry(value, episode, note))
        bucket[field] = existing
    else:
        bucket[field] = _make_entry(value, episode, note)


# ─────────────────────── 시간선 ───────────────────────

def _find_timeline(
    timeline_list: List[Dict[str, Any]],
    tid: Optional[str],
    label: Optional[str],
    target_timeline: str,
) -> Optional[Dict[str, Any]]:
    for tl in timeline_list:
        if tid and tl.get("id") == tid:
            return tl
        if label and tl.get("label") == label and tl.get("timeline") == target_timeline:
            return tl
    return None


def _new_timeline(item: Dict[str, Any], target_timeline: str) -> Dict[str, Any]:
    label = item.get("name") or item.get("label") or "사건명"
    return {
        "id": item.get("id") or f"tl_{_slug(label)}",
        "label": label,
        "timeline": target_timeline,
        "mentioned_in_episodes": [],
    }


def _merge_timeline_field(
    tl: Dict[str, Any],
    field: str,
    value: Any,
    episode: int,
    note: Optional[str],
) -> None:
    if field == "mentioned_in_episodes":
        episodes: List[int] = value if isinstance(value, list) else [value]
        current = tl.get("mentioned_in_episodes", [])
        for ep in episodes:
            if ep not in current:
                current.append(ep)
        tl["mentioned_in_episodes"] = sorted(current)


def _make_entry(value: Any, episode: int, note: Optional[str]) -> Dict[str, Any]:
    return {"value": value, "episode": episode, "note": note}
