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

export function approveItems(items: ProposedAddition[]): void {
  // 승인 전에는 설정집에 반영하지 않는다(PRD: 자동 반영 없음, 승인 후 반영).
  if (typeof window === "undefined") return;

  const settings = loadSettings();
  const updated = buildUpdatedSettings(settings, items);
  saveSettings(updated);
}

function buildUpdatedSettings(existing: string, items: ProposedAddition[]): string {
  const approved = items.filter((it) => it.category && it.category !== "제외");

  if (approved.length === 0) return existing;

  const lines: string[] = existing.split(/\r?\n/);
  const sectionIndex = (name: string) => {
    return lines.findIndex((l) => l.trim().startsWith(name));
  };

  let 인물섹션 = sectionIndex("# 등장인물");
  let 지명섹션 = sectionIndex("# 지명");
  let 세계관섹션 = sectionIndex("# 세계관");

  let 인물추가 = "";
  let 지명추가 = "";
  let 세계관추가 = "";

  for (const item of approved) {
    if (item.category === "인물") {
      인물추가 = 인물추가 ? `${인물추가}\n- ${item.name}` : `- ${item.name}`;
    } else if (item.category === "지명") {
      지명추가 = 지명추가 ? `${지명추가}\n- ${item.name}` : `- ${item.name}`;
    } else if (item.category === "세계관") {
      세계관추가 = 세계관추가 ? `${세계관추가}\n- ${item.name}` : `- ${item.name}`;
    }
  }

  if (!인물추가 && !지명추가 && !세계관추가) return existing;

  // 섹션이 없으면 생성한다.
  if (인물섹션 === -1) {
    lines.push("");
    lines.push("# 등장인물");
    인물섹션 = lines.length - 1;
  }
  if (지명섹션 === -1) {
    lines.push("");
    lines.push("# 지명");
    지명섹션 = lines.length - 1;
  }
  if (세계관섹션 === -1) {
    lines.push("");
    lines.push("# 세계관");
    세계관섹션 = lines.length - 1;
  }

  if (인물추가) {
    lines.splice(인물섹션 + 1, 0, 인물추가);
  }
  if (지명추가) {
    lines.splice(지명섹션 + 1, 0, 지명추가);
  }
  if (세계관추가) {
    lines.splice(세계관섹션 + 1, 0, 세계관추가);
  }

  return lines.join("\n");
}
