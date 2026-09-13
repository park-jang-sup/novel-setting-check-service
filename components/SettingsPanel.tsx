"use client";

import { useMemo, useState } from "react";
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



export function SettingsPanel() {
  const [settingsRaw, setSettingsRaw] = useState(loadSettings());
  const characters = useMemo(() => parseCharacterNames(settingsRaw), [settingsRaw]);
  const [editingName, setEditingName] = useState("");

  // 항목 추가 폼 상태
  const [addFormIdx, setAddFormIdx] = useState<number | null>(null);
  const [addField, setAddField] = useState("");
  const [addValue, setAddValue] = useState("");

  const handleInit = () => {
    clearSettings();
    setSettingsRaw("");
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
    saveSettings(updatedLines.join("\n"));
  };

  const handleNameChange = (newName: string) => {
    setEditingName(newName);
  };

  const openAddForm = (idx: number) => {
    setAddFormIdx(idx);
    setAddField("");
    setAddValue("");
  };

  const closeAddForm = () => {
    setAddFormIdx(null);
    setAddField("");
    setAddValue("");
  };

  const commitAddField = (idx: number) => {
    const field = addField.trim();
    if (!field) return;
    saveField(idx, field, addValue.trim());
    closeAddForm();
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
          onChange={(e) => {
            const next = e.target.value;
            setSettingsRaw(next);
            saveSettings(next);
          }}
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
                                key={`${i}-\u0000${line}`}
                                className="text-[var(--muted-foreground)]"
                              >
                                {field}:
                                <input
                                  type="text"
                                  value={val}
                                  onChange={(e) => saveField(idx, field, e.target.value)}
                                  className="ml-1 bg-transparent border-none text-[var(--foreground)] text-sm focus:outline-none"
                                />
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

                    {/* 항목 추가 버튼 / 폼 */}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {addFormIdx === idx ? (
                        <>
                          <input
                            type="text"
                            placeholder="필드명 (별칭, 나이, 소속, 불가, 비고 등)"
                            value={addField}
                            onChange={(e) => setAddField(e.target.value)}
                            onKeyDown={(e) => e.key === "Escape" && closeAddForm()}
                            className="flex-1 min-w-[120px] rounded-md border border-[var(--border)] bg-[var(--card)]/80 px-2 py-1 text-sm text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none"
                          />
                          <input
                            type="text"
                            placeholder="값"
                            value={addValue}
                            onChange={(e) => setAddValue(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && commitAddField(idx)}
                            className="flex-1 min-w-[120px] rounded-md border border-[var(--border)] bg-[var(--card)]/80 px-2 py-1 text-sm text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => commitAddField(idx)}
                            className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-sm text-white hover:bg-[var(--foreground)] transition-colors"
                          >
                            추가
                          </button>
                          <button
                            type="button"
                            onClick={closeAddForm}
                            className="rounded-md border border-[var(--border)] px-3 py-1 text-sm text-[var(--muted-foreground)] hover:bg-[var(--card)]/80 transition-colors"
                          >
                            취소
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openAddForm(idx)}
                          className="rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1 text-sm text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
                        >
                          + 항목 추가
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
