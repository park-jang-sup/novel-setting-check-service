"use client";

import { useMemo, useState, useEffect } from "react";
import { loadSettings, hasSettings, clearSettings, saveSettings } from "@/app/utils/storage";
function parseCharacterNames(settingsRaw: string): { name: string; detailLines: string[] }[] {
  const chars: { name: string; detailLines: string[] }[] = [];
  const lines = settingsRaw.split(/\r?\n/);
  let current: { name: string; detailLines: string[] } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^##\s+(.+)$/);
    if (match) {
      if (current) chars.push(current);
      current = { name: match[1], detailLines: [] };
      continue;
    }
    if (current) {
      current.detailLines.push(trimmed);
    }
  }
  if (current) chars.push(current);
  return chars;
}

function parseLocations(settingsRaw: string): string[] {
  const lines = settingsRaw.split(/\r?\n/);
  const locations: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      inSection = trimmed === "# 지명";
      continue;
    }
    if (inSection && trimmed.startsWith("- ")) {
      locations.push(trimmed.slice(2).trim());
    }
  }
  return locations;
}

function parseTimeline(settingsRaw: string): string[] {
  const lines = settingsRaw.split(/\r?\n/);
  const timeline: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      inSection = trimmed === "# 시간선";
      continue;
    }
    if (inSection) {
      const match = trimmed.match(/^\d+\.\s+(.+)$/);
      if (match) {
        timeline.push(match[1].trim());
      }
    }
  }
  return timeline;
}


export function SettingsPanel() {
  const [settingsRaw, setSettingsRaw] = useState(loadSettings());
  const characters = useMemo(() => parseCharacterNames(settingsRaw), [settingsRaw]);
  const locations = useMemo(() => parseLocations(settingsRaw), [settingsRaw]);
  const timeline = useMemo(() => parseTimeline(settingsRaw), [settingsRaw]);

  useEffect(() => {
    const handler = () => setSettingsRaw(loadSettings());
    window.addEventListener("settings-changed", handler);
    return () => window.removeEventListener("settings-changed", handler);
  }, []);

  const handleInit = () => {
    clearSettings();
    setSettingsRaw("");
  };

  const handleRawChange = (next: string) => {
    setSettingsRaw(next);
    saveSettings(next);
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 flex flex-col gap-4 flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">설정집</h2>
        <div className="flex items-center gap-2">
          {hasSettings() ? (
            <span className="text-sm text-[var(--muted-foreground)]">저장됨</span>
          ) : (
            <span className="text-sm text-[var(--muted-foreground)]">비어 있음</span>
          )}
          <button
            type="button"
            onClick={handleInit}
            className="text-sm text-[var(--accent)] underline underline-offset-2 hover:no-underline"
          >
            초기화
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-3">
        <textarea
          value={settingsRaw}
          onChange={(e) => handleRawChange(e.target.value)}
          placeholder="설정집을 여기에 직접 붙여넣으세요."
          className="flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-3 text-sm text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none whitespace-pre"
          spellCheck={false}
        />
        {characters.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            저장한 설정집이 없습니다. 회차 원고를 넣어 추가제안 목록을 만든 뒤, 승인한 항목부터 설정집에 들어갑니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {characters.map((ch, idx) => {
              // 값이 있는 라인만 필터링
              const nonEmptyLines = ch.detailLines.filter((line) => {
                const colonIdx = line.indexOf(":");
                if (colonIdx <= 0) return false;
                const val = line.slice(colonIdx + 1).trim();
                return val.length > 0;
              });

              return (
                <li
                  key={idx}
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="text-base font-medium text-[var(--foreground)]">
                      {ch.name}
                    </div>

                    {/* 값이 있는 항목만 표시 */}
                    {nonEmptyLines.length > 0 ? (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {nonEmptyLines.map((line, i) => {
                          const colonIdx = line.indexOf(":");
                          const field = colonIdx > 0 ? line.slice(0, colonIdx).trim() : "";
                          const val = colonIdx > 0 ? line.slice(colonIdx + 1).trim() : "";
                          return (
                            <span
                              key={`${i}-${line}`}
                              className="text-[var(--muted-foreground)]"
                            >
                              {field}: {val}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--muted-foreground)]">
                        아직 설정된 값이 없습니다.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
            {locations.length > 0 && (
              <li className="rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="text-base font-medium text-[var(--foreground)]">
                    지명
                  </div>
                  <ul className="flex flex-col gap-1 text-sm text-[var(--muted-foreground)]">
                    {locations.map((loc, i) => (
                      <li key={i}>{loc}</li>
                    ))}
                  </ul>
                </div>
              </li>
            )}
            {timeline.length > 0 && (
              <li className="rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="text-base font-medium text-[var(--foreground)]">
                    시간선
                  </div>
                  <ol className="flex flex-col gap-1 text-sm text-[var(--muted-foreground)]">
                    {timeline.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ol>
                </div>
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
