import { CheckResult } from "./types";

const SETTINGS_KEY = "novel-setting-check.settings";
const LAST_RESULT_KEY = "novel-setting-check.lastResult";
const LAST_MANUSCRIPT_KEY = "novel-setting-check.lastManuscript";

export function loadSettings(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? String(raw) : "";
  } catch {
    return "";
  }
}

export function saveSettings(value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      localStorage.setItem(SETTINGS_KEY, value);
    } else {
      localStorage.removeItem(SETTINGS_KEY);
    }
  } catch {
    // 무시 – 저장 실패해도 화면만 빈 상태로 남는다
  }
}

export function hasSettings(): boolean {
  return loadSettings().trim().length > 0;
}

export function clearSettings(): void {
  saveSettings("");
}

export function saveLastResult(data: CheckResult): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(data));
  } catch {
    // 무시
  }
}

export function loadLastResult(): CheckResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_RESULT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CheckResult;
  } catch {
    return null;
  }
}

export function saveLastManuscript(value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      localStorage.setItem(LAST_MANUSCRIPT_KEY, value);
    } else {
      localStorage.removeItem(LAST_MANUSCRIPT_KEY);
    }
  } catch {
    // 무시
  }
}

export function loadLastManuscript(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(LAST_MANUSCRIPT_KEY);
    return raw ? String(raw) : "";
  } catch {
    return "";
  }
}

// ─────────────────────── 에피소드 회차 기록 ───────────────────────

export interface EpisodeRun {
  label: string;
  checkedAt: number;
  errorsTotal: number;
  mediumTotal: number;
  proposed: number;
  approvedAdded: number;
  approvedSkipped: number;
  excluded: number;
}

const EPISODE_RUNS_KEY = "novel-setting-check.episodeRuns";
const CURRENT_EPISODE_LABEL_KEY = "novel-setting-check.currentEpisodeLabel";

export function saveCurrentEpisodeLabel(label: string): void {
  if (typeof window === "undefined") return;
  try {
    if (label) {
      localStorage.setItem(CURRENT_EPISODE_LABEL_KEY, label);
    } else {
      localStorage.removeItem(CURRENT_EPISODE_LABEL_KEY);
    }
  } catch {
    // 무시
  }
}

export function loadCurrentEpisodeLabel(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(CURRENT_EPISODE_LABEL_KEY);
    return raw ? String(raw) : "";
  } catch {
    return "";
  }
}

export function loadEpisodeRuns(): EpisodeRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(EPISODE_RUNS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as EpisodeRun[];
  } catch {
    return [];
  }
}

export function saveEpisodeRun(run: EpisodeRun): void {
  if (typeof window === "undefined") return;
  try {
    const runs = loadEpisodeRuns();
    const existing = runs.findIndex((r) => r.label === run.label);
    if (existing >= 0) {
      runs[existing] = run;
    } else {
      runs.push(run);
    }
    localStorage.setItem(EPISODE_RUNS_KEY, JSON.stringify(runs));
  } catch {
    // 무시
  }
}

export function mergeEpisodeRunCurrent(patch: Partial<EpisodeRun>): void {
  if (typeof window === "undefined") return;
  const label = loadCurrentEpisodeLabel();
  if (!label) return;
  const runs = loadEpisodeRuns();
  const existing = runs.find((r) => r.label === label);
  if (!existing) return;
  const updated: EpisodeRun = {
    ...existing,
    ...patch,
  };
  saveEpisodeRun(updated);
}
