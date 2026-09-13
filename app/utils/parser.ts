import { CheckResult, Violation, ProposedAddition } from "./types";
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

export interface ApprovalResult {
  added: ProposedAddition[];
  skipped: number;
}

export function approveItems(items: ProposedAddition[]): ApprovalResult {
  if (typeof window === "undefined") return { added: [], skipped: 0 };

  const settings = loadSettings();
  const result = buildUpdatedSettings(settings, items);
  saveSettings(result.updated);
  return result;
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

function buildUpdatedSettings(existing: string, items: ProposedAddition[]) {
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
    return { updated: existing, added: [], skipped };
  }

  const lines: string[] = existing.split(/\r?\n/);

  if (인물목록.length > 0) {
    let 인물섹션인덱스 = lines.findIndex((l) => CHARACTER_SECTION_HEADERS.has(l.trim()));
    if (인물섹션인덱스 === -1) {
      lines.push("");
      lines.push("# 등장인물");
      인물섹션인덱스 = lines.length - 1;
    }
    let 마지막인물인덱스 = -1;
    for (let i = 인물섹션인덱스 + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith("## ")) {
        마지막인물인덱스 = i;
      } else if (t.startsWith("# ")) {
        break;
      }
    }
    const insertAt = 마지막인물인덱스 === -1 ? 인물섹션인덱스 + 1 : 마지막인물인덱스 + 1;
    lines.splice(insertAt, 0, ...인물목록.map((n) => `## ${n}`));
  }

  if (지명목록.length > 0) {
    let 지명섹션인덱스 = lines.findIndex((l) => PLACE_SECTION_HEADERS.has(l.trim()));
    if (지명섹션인덱스 === -1) {
      lines.push("");
      lines.push("# 지명");
      지명섹션인덱스 = lines.length - 1;
    }
    let 마지막지명인덱스 = -1;
    for (let i = 지명섹션인덱스 + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith("- ")) {
        마지막지명인덱스 = i;
      } else if (t.startsWith("# ")) {
        break;
      }
    }
    const insertAt = 마지막지명인덱스 === -1 ? 지명섹션인덱스 + 1 : 마지막지명인덱스 + 1;
    lines.splice(insertAt, 0, ...지명목록.map((n) => `- ${n}`));
  }

  return { updated: lines.join("\n"), added, skipped };
}
