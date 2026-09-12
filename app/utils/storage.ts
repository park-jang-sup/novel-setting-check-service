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
