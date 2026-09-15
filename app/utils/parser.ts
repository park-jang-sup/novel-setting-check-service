import { CheckResult, Violation, ProposedAddition, EnrichCandidate, EnrichResult, EnrichItem, ApprovalResult } from "./types";
import { loadSettings, saveSettings } from "./storage";

// 실제 검사 결과는 Vercel의 /api/check에서 돌려준다.
// 프론트에서 이 함수를 호출하면 serverless 함수가 check_setting.py를 실행하고
// 그 JSON을 그대로 반환한다.
const API_BASE = "";

async function fetchCheckResult(settingsRaw: string, manuscript: string): Promise<CheckResult> {
  const res = await fetch(`${API_BASE}/api/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: settingsRaw, manuscript }),
  });

  if (!res.ok) {
    let message = `/api/check 요청 실패 (${res.status})`;
    try {
      const body = (await res.json()) as { errors?: string[] };
      if (Array.isArray(body.errors) && body.errors.length > 0) {
        message = body.errors.join("; ");
      }
    } catch {
      // json 파싱 실패 시 HTTP 상태만 사용
    }
    return {
      summary: {
        total: 0,
        high: 0,
        medium: 0,
        low: 0,
        listed: 0,
        omitted_duplicates: 0,
        proposed: 0,
        manuscript_chars: manuscript.length,
      },
      violations: [],
      proposed_additions: [],
      not_checked: [],
      errors: [message],
    };
  }

  const data = (await res.json()) as CheckResult;
  return data;
}

export async function runCheck(
  settingsRaw: string,
  manuscript: string,
): Promise<CheckResult> {
  if (!settingsRaw.trim() || !manuscript.trim()) {
    return {
      summary: {
        total: 0,
        high: 0,
        medium: 0,
        low: 0,
        listed: 0,
        omitted_duplicates: 0,
        proposed: 0,
        manuscript_chars: manuscript.length,
      },
      violations: [],
      proposed_additions: [],
      not_checked: [],
      errors: ["설정집과 원고 모두 필요합니다"],
    };
  }

  return await fetchCheckResult(settingsRaw, manuscript);
}

export interface ConflictsResult {
  summary: {
    total_found: number;
    after_dedup: number;
    dropped_rule_dup: number;
    invalid_evidence: number;
  };
  violations: Violation[];
  dropped: unknown[];
  errors: string[];
}

/**
 * /api/conflicts 호출: 솔라(solar-pro4)로 규칙(script)이 놓친 설정 충돌을 추가 찾는다.
 * rule_findings는 이미 runCheck로 얻은 CheckResult.violations를 그대로 전달한다.
 * 반환 violation에는 source="solar"가 붙어 있어 ResultsPanel에서 규칙 결과와 구분한다.
 */
export async function runConflicts(
  settingsRaw: string,
  manuscript: string,
  ruleViolations: Violation[],
): Promise<ConflictsResult> {
  if (!settingsRaw.trim() || !manuscript.trim()) {
    return {
      summary: {
        total_found: 0,
        after_dedup: 0,
        dropped_rule_dup: 0,
        invalid_evidence: 0,
      },
      violations: [],
      dropped: [],
      errors: ["설정집과 원고 모두 필요합니다"],
    };
  }

  const res = await fetch(`${API_BASE}/api/conflicts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      settings_text: settingsRaw,
      manuscript_text: manuscript,
      rule_findings: {
        summary: {},
        violations: ruleViolations,
        proposed_additions: [],
      },
    }),
  });

  if (!res.ok) {
    let message = `/api/conflicts 요청 실패 (${res.status})`;
    try {
      const body = (await res.json()) as { errors?: string[] };
      if (Array.isArray(body.errors) && body.errors.length > 0) {
        message = body.errors.join("; ");
      }
    } catch {
      // json 파싱 실패 시 HTTP 상태만 사용
    }
    return {
      summary: {
        total_found: 0,
        after_dedup: 0,
        dropped_rule_dup: 0,
        invalid_evidence: 0,
      },
      violations: [],
      dropped: [],
      errors: [message],
    };
  }

  const data = (await res.json()) as ConflictsResult;
  return data;
}

export interface RefineCandidate {
  name: string;
  count: number;
  first_line: number;
  context: string;
  note?: string;
  is_proper?: boolean;
  category?: string;
  reason?: string;
}

export interface RefineResult {
  refined: ProposedAddition[];
  before: number;
  after: number;
  errors: string[];
}

export async function refineProposedAdditions(
  items: ProposedAddition[],
): Promise<RefineResult> {
  const before = items.length;
  if (before === 0) {
    return { refined: [], before: 0, after: 0, errors: [] };
  }

  const CHUNK = 50;
  const chunks: ProposedAddition[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    chunks.push(items.slice(i, i + CHUNK));
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const res = await fetch(`${API_BASE}/api/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposed_additions: chunk }),
      });
      if (!res.ok) {
        let message = `/api/refine 요청 실패 (${res.status})`;
        try {
          const body =
            (await res.json()) as { errors?: string[] };
          if (Array.isArray(body.errors) && body.errors.length > 0) {
            message = body.errors.join("; ");
          }
        } catch {
          // json 파싱 실패 시 HTTP 상태만 사용
        }
        return { refined: [] as RefineCandidate[], errors: [message] };
      }
      const data = (await res.json()) as {
        refined?: RefineCandidate[];
        kept_count?: number;
        errors?: string[];
      };
      return {
        refined: Array.isArray(data.refined) ? data.refined : [],
        errors: Array.isArray(data.errors) ? data.errors : [],
      };
    }),
  );

  const allErrors: string[] = results.flatMap((r) => r.errors);
  const allRefined: RefineCandidate[] = results.flatMap((r) => r.refined);

  if (allErrors.length > 0) {
    return {
      refined: items,
      before,
      after: 0,
      errors: allErrors,
    };
  }

  const refined: ProposedAddition[] = allRefined
    .filter((r) => r.is_proper === true)
    .map((r) => ({
      name: r.name,
      count: r.count,
      first_line: r.first_line,
      context: r.context,
      note: r.note,
      category: undefined,
      is_proper: true,
      refine_category: r.category,
      refine_reason: r.reason,
    }));

  return {
    refined,
    before,
    after: refined.length,
    errors: [],
  };
}


export function approveItems(items: ProposedAddition[]): ApprovalResult {
  if (typeof window === "undefined") return { added: [], skipped: 0 };

  const settings = loadSettings();
  const result = buildUpdatedSettings(settings, items);
  saveSettings(result.updated);
  return result;
}

/**
 * 승인과 동시에 인물 필드 보강을 진행한다.
 * - 인물로 분류된 항목만 /api/enrich로 보내서 나이/소속/별칭/비고를 채운다.
 * - enrich 결과로 나온 인물 필드는 설정집 마크다운에 병합한다.
 * - enrich 호출에 실패하면 기존 approveItems 동작(기준선)만 유지한다.
 */
export async function approveAndEnrich(
  items: ProposedAddition[],
  settingsRaw: string,
  manuscriptText: string,
): Promise<ApprovalResult> {
  if (typeof window === "undefined") {
    return { added: [], skipped: 0 };
  }

  // 1) 기준선 승인 처리(인물/지명 구분, 중복 확인용)
  const settings = settingsRaw;
  const baseResult = buildUpdatedSettings(settings, items, /*enrichedItems=*/ undefined);
  const 인물후보 = items.filter((it) => it.category === "인물");

  // 인물 후보가 없으면 enrich 진행 없이 바로 저장
  if (인물후보.length === 0) {
    saveSettings(baseResult.updated);
    return baseResult;
  }

  // 2) enrich 대상 목록 구성
  const candidates: EnrichCandidate[] = 인물후보.map((it) => ({
    name: it.name.trim(),
    episode: it.first_line > 0 ? it.first_line : undefined,
  }));

  let enriched: EnrichItem[] = [];
  try {
    const res = await fetch(`${API_BASE}/api/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate_names: candidates,
        settings_text: settings,
        manuscript_text: manuscriptText,
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { errors?: string[] };
      const msg = body?.errors?.join("; ") ?? `/api/enrich 요청 실패 (${res.status})`;
      console.warn("[approveAndEnrich] enrich 실패, 기준선만 저장:", msg);
    } else {
      const data = (await res.json()) as EnrichResult;
      if (data.enriched && Array.isArray(data.enriched)) {
        enriched = data.enriched;
      }
    }
  } catch (e) {
    console.warn("[approveAndEnrich] enrich 네트워크 실패, 기준선만 저장:", String(e));
  }

  // 3) 인물 후보별 enrich 정보를 반영한 설정집 갱신
  const updated = buildUpdatedSettings(settings, items, enriched);

  saveSettings(updated.updated);
  return {
    added: baseResult.added,
    skipped: baseResult.skipped,
    enrichedItems: enriched,
  };
}

interface ExistingNames {
  인물: Set<string>;
  별칭: Set<string>;
  지명: Set<string>;
}

const CHARACTER_SECTION_HEADERS = new Set(["# 등장인물", "# 인물"]);
const PLACE_SECTION_HEADERS = new Set(["# 지명", "# 장소"]);

function extractExistingNames(text: string): ExistingNames {
  const 인물 = new Set<string>();
  const 별칭 = new Set<string>();
  const 지명 = new Set<string>();
  let section: "characters" | "places" | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("# ")) {
      if (CHARACTER_SECTION_HEADERS.has(line)) {
        section = "characters";
      } else if (PLACE_SECTION_HEADERS.has(line)) {
        section = "places";
      } else {
        section = null;
      }
      continue;
    }
    if (line.startsWith("## ")) {
      if (section === "characters") {
        인물.add(line.slice(3).trim());
      }
      continue;
    }
    if (section === "characters") {
      const m = line.match(/^\s*-\s*([^:]+):\s*(.+)$/);
      if (m) {
        const field = m[1].trim();
        if (field === "별칭") {
          for (const v of m[2].split(",")) {
            별칭.add(v.trim());
          }
        }
      }
      continue;
    }
    if (section === "places") {
      const m = line.match(/^\s*-\s+(.+)$/);
      if (m) {
        지명.add(m[1].trim());
      }
    }
  }

  return { 인물, 별칭, 지명 };
}

function buildUpdatedSettings(
  existing: string,
  items: ProposedAddition[],
  enrichedItems?: EnrichItem[],
): { updated: string; added: ProposedAddition[]; skipped: number } {
  const existingNames = extractExistingNames(existing);
  const approved = items.filter((it) => it.category && it.category !== "제외");

  const added: ProposedAddition[] = [];
  let skipped = 0;

  const 인물목록: string[] = [];
  const 지명목록: string[] = [];

  for (const item of approved) {
    const name = item.name.trim();
    if (!name) continue;

    if (item.category === "인물") {
      if (existingNames.인물.has(name) || existingNames.별칭.has(name)) {
        skipped++;
        continue;
      }
      인물목록.push(name);
      added.push(item);
    } else if (item.category === "지명" || item.category === "세계관") {
      if (existingNames.지명.has(name)) {
        skipped++;
        continue;
      }
      지명목록.push(name);
      added.push(item);
    }
  }

  if (인물목록.length === 0 && 지명목록.length === 0) {
    return { updated: existing, added, skipped };
  }

  const enrichMap = new Map<string, EnrichItem>();
  if (enrichedItems && Array.isArray(enrichedItems)) {
    for (const item of enrichedItems) {
      if (!item || !item.name) continue;
      const key = item.name.trim();
      if (!key) continue;
      // 인물 후보 중 이미 approved된 이름만 반영 대상으로 본다
      if (!인물목록.includes(key)) continue;
      enrichMap.set(key, item);
    }
  }

  const lines: string[] = existing.split(/\r?\n/);

  if (인물목록.length > 0) {
    let 인물섹션인덱스 = lines.findIndex(
      (l) => CHARACTER_SECTION_HEADERS.has(l.trim()),
    );
    if (인물섹션인덱스 === -1) {
      lines.push("");
      lines.push("# 등장인물");
      인물섹션인덱스 = lines.length - 1;
    }
    let sectionEndIndex = 인물섹션인덱스;
    for (let i = 인물섹션인덱스 + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith("# ")) break;
      sectionEndIndex = i;
    }
    const insertAt = sectionEndIndex + 1;

    const 인물블록줄들: string[] = [];
    for (const n of 인물목록) {
      인물블록줄들.push(`## ${n}`);
      const enriched = enrichMap.get(n);
      if (enriched && enriched.fields) {
        const f = enriched.fields;
        const fieldLines: string[] = [];
        if (f.age !== undefined && f.age !== null)
          fieldLines.push(`- 나이: ${f.age}`);
        if (f.affiliation !== undefined && f.affiliation !== null)
          fieldLines.push(`- 소속: ${f.affiliation}`);
        if (
          f.aliases &&
          Array.isArray(f.aliases) &&
          f.aliases.length > 0
        ) {
          fieldLines.push(`- 별칭: ${f.aliases.join(", ")}`);
        }
        if (f.notes !== undefined && f.notes !== null)
          fieldLines.push(`- 비고: ${f.notes}`);
        인물블록줄들.push(...fieldLines);
      }
    }
    lines.splice(insertAt, 0, ...인물블록줄들);
  }

  if (지명목록.length > 0) {
    let 지명섹션인덱스 = lines.findIndex(
      (l) => PLACE_SECTION_HEADERS.has(l.trim()),
    );
    if (지명섹션인덱스 === -1) {
      lines.push("");
      lines.push("# 지명");
      지명섹션인덱스 = lines.length - 1;
    }
    let sectionEndIndex = 지명섹션인덱스;
    for (let i = 지명섹션인덱스 + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith("# ")) break;
      sectionEndIndex = i;
    }
    const insertAt = sectionEndIndex + 1;
    lines.splice(
      insertAt,
      0,
      ...지명목록.map((n) => `- ${n}`),
    );
  }

  return { updated: lines.join("\n"), added, skipped };
}

/**
 * `detail`에서 "등록명 'XX'와 유사한 표기입니다" 형식의 등록명을 추출한다.
 * 예: check_setting.py의 name_variant detail.
 */
export function extractRegisteredNameFromDetail(detail: string): string | null {
  const m = detail.match(/등록명\s+'([^']+)'/u);
  return m ? m[1] : null;
}

/**
 * name이 설정집에서 지명 섹션(# 지명 / # 장소)에 등록되어 있으면 true.
 */
export function isPlaceName(name: string, settingsRaw: string): boolean {
  let section: "characters" | "places" | null = null;
  const target = name.trim();
  for (const raw of settingsRaw.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("# ")) {
      if (CHARACTER_SECTION_HEADERS.has(line)) {
        section = "characters";
      } else if (PLACE_SECTION_HEADERS.has(line)) {
        section = "places";
      } else {
        section = null;
      }
      continue;
    }
    if (line.startsWith("## ")) {
      continue;
    }
    if (section === "places") {
      const m = line.match(/^\s*-\s+(.+)$/);
      if (m && m[1].trim() === target) {
        return true;
      }
    }
  }
  return false;
}

/**
 * name이 설정집에서 인물 섹션(# 등장인물 / # 인물)의 ## 이름으로 등록되어 있으면 true.
 * 별칭·필드 줄은 보지 않고 "## 이름" 줄 기준으로만 본다.
 */
export function isCharacterRegistered(name: string, settingsRaw: string): boolean {
  let section: "characters" | "places" | null = null;
  const target = name.trim();
  for (const raw of settingsRaw.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("# ")) {
      section = CHARACTER_SECTION_HEADERS.has(line) ? "characters" : "places";
      continue;
    }
    if (section === "characters" && line.startsWith("## ")) {
      if (line.slice(3).trim() === target) return true;
    }
  }
  return false;
}


/**
 * 별칭 등록 결과를 반환한다.
 *
 * - alias(별칭으로 추가할 이름)가 속한 인물 블록을 ownerLookupName 기준으로 찾는다.
 *   - ownerLookupName이 인물 이름이면 해당 인물 블록,
 *   - ownerLookupName이 이미 별칭이면 그 별칭을 가진 인물 블록.
 * - 해당 인물 블록의 `- 별칭:` 줄에 alias를 추가한다(없으면 줄 생성).
 * - alias가 인물 이름이면 added=false, 별칭이면 added=true.
 * - alias가 지명이면 error 반환.
 */
export interface RegisterAliasResult {
  updated: string;
  added: boolean;
  ownerName: string | null;
  error?: string;
}

export function registerAlias(
  alias: string,
  ownerLookupName: string,
  settingsRaw: string,
): RegisterAliasResult {
  const target = alias.trim();
  if (!target) {
    return { updated: settingsRaw, added: false, ownerName: null, error: "별칭 이름이 비어 있습니다" };
  }

  if (isPlaceName(target, settingsRaw)) {
    return { updated: settingsRaw, added: false, ownerName: null, error: "지명은 별칭으로 등록할 수 없습니다" };
  }

  // 인물 블록 찾기: ownerLookupName(등록명) 기준
  const owner = findCharacterOwner(ownerLookupName.trim(), settingsRaw);
  if (!owner) {
    return { updated: settingsRaw, added: false, ownerName: null, error: "해당 이름의 인물 블록을 찾을 수 없습니다" };
  }

  const lines: string[] = settingsRaw.split(/\r?\n/);
  const characterBlock = findCharacterBlockLines(lines, owner.blockIndex);
  if (!characterBlock) {
    return { updated: settingsRaw, added: false, ownerName: null, error: "인물 블록 라인을 찾지 못했습니다" };
  }

  const existingNames = extractExistingNames(settingsRaw);
  const alreadyExists = existingNames.인물.has(target) || existingNames.별칭.has(target);

  let updatedBlock: string[];
  if (characterBlock.별칭 !== undefined) {
    const currentAliases = characterBlock.별칭
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (currentAliases.includes(target)) {
      return { updated: settingsRaw, added: false, ownerName: owner.name, error: undefined };
    }
    currentAliases.push(target);
    const newAliasLine = `- 별칭: ${currentAliases.join(", ")}`;
    updatedBlock = characterBlock.lines.map((l) => (l === characterBlock.별칭 ? newAliasLine : l));
  } else {
    // `- 별칭:` 줄이 아예 없으면 첫 번째 필드 줄 앞에 삽입
    const insertIndex = characterBlock.firstFieldLineIndex;
    const newAliasLine = `- 별칭: ${target}`;
    updatedBlock = [
      ...characterBlock.lines.slice(0, insertIndex),
      newAliasLine,
      ...characterBlock.lines.slice(insertIndex),
    ];
  }

  const blockStart = owner.blockIndex;
  const blockEnd = blockStart + characterBlock.lines.length;
  const newLines = [
    ...lines.slice(0, blockStart),
    ...updatedBlock,
    ...lines.slice(blockEnd),
  ];

  return {
    updated: newLines.join("\n"),
    added: !alreadyExists,
    ownerName: owner.name,
    error: undefined,
  };
}

interface CharacterBlockLines {
  lines: string[];
  별칭: string | undefined;
  firstFieldLineIndex: number;
}

/**
 * blockIndex부터 다음 ## 또는 # 섹션 머리글 전까지의 인물 블록 라인을 추출한다.
 * 반환값은 블록 라인과, 기존 `- 별칭:` 줄, 첫 필드 줄 인덱스를 포함한다.
 */
function findCharacterBlockLines(
  lines: string[],
  blockIndex: number,
): CharacterBlockLines | null {
  const start = blockIndex;
  const linesCollected: string[] = [];
  let 별칭: string | undefined = undefined;
  let firstFieldLineIndex = -1;

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (t.startsWith("# ")) {
      break;
    }
    if (t.startsWith("## ")) {
      if (i > start) break;
    }
    linesCollected.push(raw);
    if (firstFieldLineIndex === -1) {
      const m = t.match(/^\s*-\s+([^:]+):/);
      if (m) {
        firstFieldLineIndex = linesCollected.length - 1;
      }
    }
    const m2 = t.match(/^\s*-\s*별칭:\s*(.+)$/);
    if (m2) {
      별칭 = m2[1];
    }
  }

  if (linesCollected.length === 0) return null;
  return { lines: linesCollected, 별칭, firstFieldLineIndex };
}

/**
 * 설정집에서 인물 이름이나 별칭으로 인물 블록을 찾는다.
 * 반환: { name: 인물 이름, blockIndex: ## 줄 인덱스 } | null
 */
export interface CharacterOwner {
  name: string;
  blockIndex: number;
}

export function findCharacterOwner(
  name: string,
  settingsRaw: string,
): CharacterOwner | null {
  const target = name.trim();
  if (!target) return null;

  const existingNames = extractExistingNames(settingsRaw);
  if (existingNames.인물.has(target)) {
    // 인물 이름으로 블록 인덱스 찾기
    return findCharacterBlockByValue(linesOf(settingsRaw), (l) => {
      const m = l.match(/^\s*##\s+(.+)$/);
      return m ? m[1].trim() === target : false;
    });
  }

  if (existingNames.별칭.has(target)) {
    // 별칭으로 인물 찾기: 해당 별칭 줄을 가진 인물 블록의 이름
    const lines = linesOf(settingsRaw);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*##\s+(.+)$/);
      if (!m) continue;
      const blockName = m[1].trim();
      const blockLines = collectUntilSectionOrNextCharacter(lines, i + 1);
      for (const b of blockLines) {
        const am = b.match(/^\s*-\s*별칭:\s*(.+)$/);
        if (am) {
          const aliases = am[1].split(",").map((s) => s.trim());
          if (aliases.includes(target)) {
            return { name: blockName, blockIndex: i };
          }
        }
      }
    }
  }

  return null;
}

function linesOf(text: string): string[] {
  return text.split(/\r?\n/);
}

function collectUntilSectionOrNextCharacter(lines: string[], start: number): string[] {
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("# ")) {
      break;
    }
    if (t.startsWith("## ")) {
      break;
    }
    out.push(lines[i]);
  }
  return out;
}

function findCharacterBlockByValue(
  lines: string[],
  predicate: (line: string) => boolean,
): CharacterOwner | null {
  for (let i = 0; i < lines.length; i++) {
    if (predicate(lines[i])) {
      const m = lines[i].match(/^\s*##\s+(.+)$/);
      if (m) {
        return { name: m[1].trim(), blockIndex: i };
      }
    }
  }
  return null;
}
