"use client";

import { useState, useEffect } from "react";
import { loadSettings, saveLastResult, loadSettings as loadStored } from "@/app/utils/storage";
import { ClassificationButtons } from "@/components/ClassificationButtons";
import { CheckResult, Violation, ProposedAddition, PresetCategory } from "@/app/utils/types";

type Group = "설정오류" | "확인 필요" | "추가 제안" | "판정 불가";

function toGroup(v: Violation): Group {
  if (v.severity === "high") return "설정오류";
  return "확인 필요";
}

interface CollapsedGroup {
  group: Group;
  count: number;
}

export function ResultsPanel({ result }: { result: CheckResult | null }) {
  const [raw] = useState(loadStored());
  const [collapsed, setCollapsed] = useState<CollapsedGroup[]>([]);

  useEffect(() => {
    // 저장값이 바뀔 수 있으므로 매 렌더 시점에 최신 값 반영
  }, [raw]);

  const groups: Group[] = ["설정오류", "확인 필요", "추가 제안", "판정 불가"];

  const itemsInGroup = (group: Group) => {
    if (group === "설정오류" || group === "확인 필요") {
      return (result?.violations ?? []).filter((v) => toGroup(v) === group);
    }
    if (group === "추가 제안") {
      return (result?.proposed_additions ?? []).filter((p) => p.category !== "제외");
    }
    return [];
  };

  const counts = groups.map((g) => ({
    group: g,
    count: itemsInGroup(g).length,
    collapsed: collapsed.some((c) => c.group === g),
  }));

  const toggleCollapsed = (group: Group) => {
    setCollapsed((prev) =>
      prev.some((c) => c.group === group)
        ? prev.filter((c) => c.group !== group)
        : [...prev, { group, count: itemsInGroup(group).length }]
    );
  };

  const hasItems = counts.some((c) => c.count > 0);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">검사 결과</h2>
      </div>

      {result ? (
        <>
          {/* 네 방향 요약 막대 */}
          <div className="flex flex-wrap gap-2">
            {counts.map(({ group, count, collapsed: isCollapsed }) => (
              <button
                key={group}
                type="button"
                onClick={() => toggleCollapsed(group)}
                className={`rounded-full border px-4 py-2 text-sm border-[var(--border)] bg-[var(--card)]/80 text-[var(--foreground)] hover:bg-[var(--card)] transition-colors ${
                  isCollapsed ? "opacity-60" : ""
                }`}
              >
                <span className="font-medium">{group}</span>
                <span className="ml-2 text-[var(--muted-foreground)]">{count}건</span>
              </button>
            ))}
          </div>

          {/* 설정오류 / 확인 필요 */}
          {(counts[0].count > 0 || counts[1].count > 0) && (
            <div className="flex flex-col gap-3">
              {["설정오류", "확인 필요"].map((group) => {
                const items = itemsInGroup(group as Group) as Violation[];
                return (
                  <div key={group} className="flex flex-col gap-3">
                    <h3 className="text-sm font-medium">
                      {group} · {items.length}건
                    </h3>
                    {items.map((v, idx) => (
                      <div key={`${v.line}-${v.subject}-${idx}`} className="rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
                              <span className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-0.5">
                                {v.type}
                              </span>
                              <span>줄 {v.line}</span>
                            </div>
                            <p className="mt-2 text-sm font-medium">{v.subject}</p>
                            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{v.detail}</p>
                            <pre className="mt-2 max-w-full overflow-auto rounded border border-[var(--border)] bg-[var(--card)] p-2 text-[11px] leading-relaxed text-[var(--muted-foreground)] whitespace-pre-wrap break-words">
                              {v.context}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* 추가 제안 */}
          {counts[2].count > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">
                추가 제안 · {itemsInGroup("추가 제안").length}건
              </h3>
              <div className="flex flex-col gap-2">
                {(itemsInGroup("추가 제안") as ProposedAddition[]).map((p, idx) => (
                  <div
                    key={`${p.name}-${idx}`}
                    className="rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{p.name}</span>
                          <span className="text-xs text-[var(--muted-foreground)]">
                            {p.count}회 · 첫 등장 줄 {p.first_line}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-[var(--muted-foreground)]">{p.context}</p>
                        {collapsed.some((c) => c.group === "추가 제안") ? (
                          <button
                            type="button"
                            onClick={() => toggleCollapsed("추가 제안")}
                            className="mt-2 text-xs text-[var(--accent)] underline underline-offset-2 hover:no-underline"
                          >
                            펼치기
                          </button>
                        ) : (
                          <ClassificationButtons
                            value={p.category ?? undefined}
                            onChange={(cat) => {
                              const next = result?.proposed_additions ?? [];
                              const updated = next.map((n) =>
                                n === p ? { ...n, category: cat } : n
                              );
                              // 분류만 화면에 반영하고, 설정집 저장은 승인 시점에 따로 처리한다.
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 판정 불가 */}
          {counts[3].count > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">판정 불가 · {itemsInGroup("판정 불가").length}건</h3>
              <p className="text-sm text-[var(--muted-foreground)]">
                검사하지 못한 항목이 있을 때만 표시됩니다. 현재는 검사 대상이 모두 처리되었습니다.
              </p>
            </div>
          )}

          {/* 오류가 있으면 표시 */}
          {(result.errors?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4 text-sm text-[var(--muted-foreground)]">
              <span className="font-medium text-[var(--foreground)]">오류</span>
              {result.errors.map((e, idx) => (
                <p key={idx}>{e}</p>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)]/60 p-4 text-sm text-[var(--muted-foreground)]">
          <p>아직 검사하지 않았습니다.</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>왼쪽 설정집 또는 오른쪽 원고를 준비합니다.</li>
            <li>원고 입력창에 회차를 붙여넣습니다.</li>
            <li>원고 아래 검사하기 버튼을 누릅니다.</li>
          </ol>
        </div>
      )}
    </section>
  );
}
