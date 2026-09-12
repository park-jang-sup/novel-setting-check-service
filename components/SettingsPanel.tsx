"use client";

import { useMemo, useState } from "react";
import { loadSettings, hasSettings, clearSettings } from "@/app/utils/storage";
import { PresetCategory } from "@/app/utils/types";

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

function parseEpisodeIndex(settingsRaw: string, name: string): number[] {
  // 설정집 문자열에서 인물 이름이 등장한 위치를 단순 라인 번호로 매핑한다.
  // 실제 검사 JSON의 line 필드와 직접 연동되기 전까지 UI용 근사값이다.
  const lines = settingsRaw.split(/\r?\n/);
  const hits: number[] = [];
  const target = name.trim();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(target)) hits.push(i + 1);
  }
  return hits;
}

export function SettingsPanel() {
  const [settingsRaw, setSettingsRaw] = useState(loadSettings());
  const characters = useMemo(() => parseCharacterNames(settingsRaw), [settingsRaw]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  const handleInit = () => {
    clearSettings();
    setSettingsRaw("");
  };

  const toggleLineCounts = (idx: number) => {
    setExpandedIdx((prev) => (prev === idx ? null : idx));
  };

  const saveField = (idx: number, field: string, value: string) => {
    const updatedLines = [...settingsRaw.split(/\r?\n/)];
    const start = updatedLines.findIndex((l) => l.trim().startsWith(`## ${characters[idx].name}`));
    if (start === -1) return;

    let targetLine = -1;
    for (let i = start + 1; i < updatedLines.length; i++) {
      if (updatedLines[i].trim().startsWith(field)) {
        targetLine = i;
        break;
      }
    }

    if (targetLine === -1) {
      // 필드가 없으면 새로 추가
      const newLine = `- ${field}: ${value}`;
      const nextSection = updatedLines.findIndex((l, i) => i > start && l.trim().startsWith("# "));
      if (nextSection === -1) {
        updatedLines.push(newLine);
      } else {
        updatedLines.splice(nextSection, 0, newLine);
      }
    } else {
      const existing = updatedLines[targetLine];
      const afterColon = existing.includes(":");
      const head = afterColon ? existing.split(":")[0] + ":" : `- ${field}:`;
      updatedLines[targetLine] = `${head} ${value}`.trimEnd();
    }

    setSettingsRaw(updatedLines.join("\n"));
  };

  const handleNameChange = (newName: string) => {
    setEditingName(newName);
  };

  const countLinesFor = (name: string) => {
    const count = parseEpisodeIndex(settingsRaw, name);
    return count.length > 0 ? count.join(", ") : "0";
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

      <div className="flex-1 flex flex-col">
        {characters.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            저장한 설정집이 없습니다. 회차 원고를 넣어 추가제안 목록을 만든 뒤, 승인한 항목부터 설정집에 들어갑니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {characters.map((ch, idx) => {
              const lines = parseEpisodeIndex(settingsRaw, ch.name);
              const lineCount = lines.length;
              return (
                <li
                  key={idx}
                  className="rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editingName || ch.name}
                          onChange={(e) => handleNameChange(e.target.value)}
                          onBlur={() => {
                            if (editingName && editingName.trim() && editingName.trim() !== ch.name) {
                              handleNameChange("");
                            }
                          }}
                          className="text-base font-medium bg-transparent border-none text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none"
                          placeholder="인물 이름"
                        />
                        <span className="text-sm text-[var(--muted-foreground)]">
                          {lineCount}회
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {ch.detailLines.map((line) => {
                          const colonIdx = line.indexOf(":");
                          const field = colonIdx > 0 ? line.slice(0, colonIdx).trim() : "";
                          const val = colonIdx > 0 ? line.slice(colonIdx + 1).trim() : "";
                          return (
                            <span key={field} className="text-[var(--muted-foreground)]">
                              {field}:
                              {val ? (
                                <input
                                  type="text"
                                  value={val}
                                  onChange={(e) => saveField(idx, field, e.target.value)}
                                  className="ml-1 bg-transparent border-none text-[var(--foreground)] text-sm focus:outline-none"
                                />
                              ) : (
                                <input
                                  type="text"
                                  value=""
                                  onChange={(e) => saveField(idx, field, e.target.value)}
                                  className="ml-1 bg-transparent border-none text-[var(--foreground)] text-sm focus:outline-none placeholder-[var(--muted-foreground)]"
                                  placeholder="입력"
                                />
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleLineCounts(idx)}
                      className="text-sm text-[var(--accent)] underline underline-offset-2 hover:no-underline shrink-0 pt-1"
                    >
                      {lineCount > 0 ? `몇 화 (${lineCount}개)` : "표기 없음"}
                    </button>
                  </div>

                  {expandedIdx === idx && lineCount > 0 && (
                    <div className="mt-3 rounded border border-[var(--border)] bg-[var(--card)]/60 p-3 text-sm text-[var(--muted-foreground)]">
                      <span className="font-medium text-[var(--foreground)]">등장 라인:</span>{" "}
                      {lines.join(", ")}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
