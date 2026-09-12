import { CheckResult, Violation, ProposedAddition } from "./types";
import { loadSettings, saveSettings } from "./storage";

// 실제 배포 환경에서는 여기서 scripts/check_setting.py를 호출한다(서버 측).
// MVP 단계에서는 test/output.json을 읽은 고정 결과를 기준으로 화면 구조를 검증한다.
// 실제 구현(C 단계)에서 스크립트 실행 결과 JSON으로 교체한다.
// 클라이언트 컴포넌트에서 이 파일을 import할 때는 서버 전용 fs 접근을 하지 않는다.

const PLACEHOLDER_RESULT: CheckResult = {
  summary: {
    total: 10,
    high: 0,
    medium: 10,
    low: 0,
    listed: 10,
    omitted_duplicates: 0,
    proposed: 42,
    manuscript_chars: 12263,
  },
  violations: [],
  proposed_additions: [],
  not_checked: [],
  errors: [],
};

function classifyViolation(v: Violation): "설정오류" | "확인 필요" {
  if (v.severity === "high") return "설정오류";
  return "확인 필요";
}

export function runCheck(settingsRaw: string, manuscript: string): CheckResult {
  // 실제 구현이 들어오면 여기서 서버 측 읽기/스크립트 호출 결과를 반환한다.
  // 현재는 화면 구조 검증용 고정 결과를 반환한다.
  return {
    ...PLACEHOLDER_RESULT,
    summary: {
      ...PLACEHOLDER_RESULT.summary,
      manuscript_chars: manuscript.length,
    },
  };
}

export function extractProposedAdditions(settingsRaw: string, manuscript: string): ProposedAddition[] {
  const result = runCheck(settingsRaw, manuscript);
  return result.proposed_additions;
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

  const 인물섹션 = sectionIndex("# 등장인물");
  const 지명섹션 = sectionIndex("# 지명");
  const 세계관섹션 = sectionIndex("# 세계관");

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
