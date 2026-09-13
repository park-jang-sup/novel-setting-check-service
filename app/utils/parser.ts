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
