"use client";

import { useState, useEffect } from "react";
import { loadSettings, saveLastResult, loadSettings as loadStored } from "@/app/utils/storage";
import { ClassificationButtons } from "@/components/ClassificationButtons";
import { CheckResult, Violation, ProposedAddition, PresetCategory } from "@/app/utils/types";
import { refineProposedAdditions, RefineResult, approveItems } from "@/app/utils/parser";

type Group = "설정오류" | "확인 필요" | "추가 제안" | "판정 불가";

function toGroup(v: Violation): Group {
  if (v.severity === "high") return "설정오류";
  return "확인 필요";
}

export function ResultsPanel({ result }: { result: CheckResult | null }) {
  const [raw] = useState(loadStored());
  const [activeGroup, setActiveGroup] = useState<Group>("설정오류");
  const [refinedResult, setRefinedResult] = useState<RefineResult | null>(null);
  const [refineInProgress, setRefineInProgress] = useState(false);
  const [pendingItems, setPendingItems] = useState<ProposedAddition[]>([]);
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);

  // 결과가 바뀔 때 제안 목록을 화면 전용 상태로 초기화
  useEffect(() => {
    if (!result) {
      setPendingItems([]);
      setApprovalMessage(null);
      return;
    }
    setPendingItems(result.proposed_additions ?? []);
  }, [result]);

  const groups: Group[] = ["설정오류", "확인 필요", "추가 제안", "판정 불가"];

  const counts = groups.map((g) => ({
    group: g,
    count:
      g === "추가 제안"
        ? pendingItems.length
        : (result?.violations ?? []).filter((v) => toGroup(v) === g).length,
  }));

  const handleRefine = async () => {
    if (!result?.proposed_additions) return;
    setRefineInProgress(true);
    try {
      const r = await refineProposedAdditions(result.proposed_additions);
      setRefinedResult(r);
      if (r.errors.length === 0 && r.after !== undefined && r.after > 0) {
        setPendingItems(r.refined);
      }
    } finally {
      setRefineInProgress(false);
    }
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">검사 결과</h2>
      </div>

      {result ? (
        <>
          {/* 탭 바 */}
          <div className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-0">
            {groups.map((group) => {
              const count = counts.find((c) => c.group === group)?.count ?? 0;
              const isActive = activeGroup === group;
              return (
                <button
                  key={group}
                  type="button"
                  onClick={() => setActiveGroup(group)}
                  className={`relative rounded-t-md px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? "text-[var(--foreground)] font-semibold border-b-2 border-[var(--foreground)] -mb-[1px]"
                      : "text-[var(--muted-foreground)] border-b-2 border-transparent"
                  }`}
                >
                  {group}
                  <span className="ml-2 text-[var(--muted-foreground)]">{count}건</span>
                </button>
              );
            })}
          </div>

          {/* 정제 컨트롤 — 추가 제안 탭일 때만 표시 */}
          {activeGroup === "추가 제안" && counts[2].count > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">Solar로 정리</h3>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {refinedResult?.before ?? counts[2].count}건의 추가 제안을 Solar로 분류·정리합니다.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {refinedResult?.errors.length === 0 && refinedResult?.after !== undefined && (
                    <span className="text-sm text-[var(--muted-foreground)]">
                      {refinedResult.before}건 → {refinedResult.after}건
                    </span>
                  )}
                  {!refineInProgress && refinedResult === null && (
                    <button
                      type="button"
                      onClick={handleRefine}
                      className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-4 py-1.5 text-sm text-white hover:bg-[var(--foreground)] transition-colors"
                    >
                      Solar로 정리
                    </button>
                  )}
                  {refineInProgress && (
                    <span className="text-sm text-[var(--muted-foreground)]">정리 중…</span>
                  )}
                </div>
              </div>
              {(refinedResult?.errors.length ?? 0) > 0 && (
                <div className="flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4 text-sm text-[var(--muted-foreground)]">
                  <span className="font-medium text-[var(--foreground)]">정리 중 오류</span>
                  {refinedResult?.errors.map((e, idx) => (
                    <p key={idx}>{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 활성 탭 콘텐츠 */}
          {activeGroup === "설정오류" && counts[0].count > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">설정오류 · {counts[0].count}건</h3>
              {(result?.violations ?? []).filter((v) => toGroup(v) === "설정오류").map((v, idx) => (
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
          )}

          {activeGroup === "확인 필요" && counts[1].count > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">확인 필요 · {counts[1].count}건</h3>
              {(result?.violations ?? []).filter((v) => toGroup(v) === "확인 필요").map((v, idx) => (
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
          )}

          {activeGroup === "추가 제안" && counts[2].count > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">
                추가 제안 · {pendingItems.length}건
              </h3>

              {approvalMessage && (
                <div className="flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-3 text-sm">
                  <span className="font-medium text-[var(--foreground)]">반영 결과</span>
                  <p className="text-[var(--muted-foreground)]">{approvalMessage}</p>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {pendingItems
                  .filter((p) => p.category !== "제외")
                  .map((p, idx) => (
                    <div
                      key={`${p.name}-${idx}`}
                      className="rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{p.name}</span>
                            {p.is_proper === true && (
                              <span className="text-xs text-[var(--muted-foreground)]">
                                Solar 정리됨 · {p.count}회 · 첫 등장 줄 {p.first_line}
                              </span>
                            )}
                            {p.is_proper !== true && (
                              <span className="text-xs text-[var(--muted-foreground)]">
                                {p.count}회 · 첫 등장 줄 {p.first_line}
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-sm text-[var(--muted-foreground)]">{p.context}</p>
                          {p.refine_reason && (
                            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                              {p.refine_reason}
                            </p>
                          )}
                        </div>
                      </div>
                      <ClassificationButtons
                        value={p.category ?? undefined}
                        onChange={(cat) => {
                          setPendingItems((prev) =>
                            prev.map((n) => (n === p ? { ...n, category: cat } : n))
                          );
                        }}
                      />
                    </div>
                  ))}
              </div>

              {(() => {
                const categorizedCount = pendingItems.filter(
                  (p) => p.category === "인물" || p.category === "지명" || p.category === "세계관"
                ).length;
                return categorizedCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      const resultOfApproval = approveItems(pendingItems);
                      const addedCount = resultOfApproval.added.length;
                      const skippedCount = resultOfApproval.skipped;
                      const excludedCount = pendingItems.filter(
                        (p) => p.category === "제외"
                      ).length;
                      const totalRemoved = addedCount + skippedCount + excludedCount;

                      setApprovalMessage(
                        `설정집에 반영 ${addedCount}건, 이미 있어서 건너뛴 ${skippedCount}건` +
                          (excludedCount > 0
                            ? `, 제외한 ${excludedCount}건`
                            : "") +
                          ` (총 ${totalRemoved}건 처리)`
                      );
                      setPendingItems((prev) =>
                        prev.filter((p) => p.category !== "제외")
                      );
                    }}
                    className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--primary)]/90 whitespace-nowrap"
                  >
                    설정집 반영 {categorizedCount}건
                  </button>
                ) : null;
              })()}
            </div>
          )}

          {activeGroup === "판정 불가" && counts[3].count > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">판정 불가 · {counts[3].count}건</h3>
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
