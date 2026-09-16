"use client";

import { useState, useEffect } from "react";
import { loadSettings, saveLastResult, loadSettings as loadStored, loadLastManuscript, saveLastManuscript, saveSettings } from "@/app/utils/storage";
import { ClassificationButtons } from "@/components/ClassificationButtons";
import { CheckResult, Violation, ProposedAddition, PresetCategory } from "@/app/utils/types";
import { refineProposedAdditions, RefineResult, approveAndEnrich, runConflicts, extractRegisteredNameFromDetail, registerAlias, isPlaceName, isCharacterRegistered } from "@/app/utils/parser";

type Group = "설정오류" | "추가 제안" | "판정 불가";

export interface FixResult {
  revised_manuscript: string;
  summary: {
    confirmed_count: number;
    revised_length: number;
    original_length: number;
  };
  changes: {
    item_index: number;
    subject: string;
    change_description: string;
    original_snippet: string;
    revised_snippet: string;
  }[];
  errors: string[];
}

export function ResultsPanel({ result, onManuscriptChange }: { result: CheckResult | null; onManuscriptChange?: (value: string) => void }) {
  const [raw] = useState(loadStored());
  const [activeGroup, setActiveGroup] = useState<Group>("설정오류");
  const [refinedResult, setRefinedResult] = useState<RefineResult | null>(null);
  const [pendingItems, setPendingItems] = useState<ProposedAddition[]>([]);
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);

  // 전체 검토(정리 + 설정오류 찾기) 통합 상태
  const [reviewInProgress, setReviewInProgress] = useState(false);
  const [reviewRefineError, setReviewRefineError] = useState<string | null>(null);
  const [reviewConflictError, setReviewConflictError] = useState<string | null>(null);

  // 솔라로 설정충돌 추가 탐색 결과 (source="solar"인 violations)
  const [solarViolations, setSolarViolations] = useState<Violation[]>([]);
  const [solarFetching, setSolarFetching] = useState(false);
  const [solarError, setSolarError] = useState<string | null>(null);
  const [solarDecisions, setSolarDecisions] = useState<Record<string, "pending" | "confirmed" | "removed">>({});
  const [removedRuleKeys, setRemovedRuleKeys] = useState<Set<string>>(new Set());
  const [ruleActionError, setRuleActionError] = useState<string | null>(null);

  // 확정 기반 원고 수정 상태
  const [confirmedItems, setConfirmedItems] = useState<Violation[]>([]);
  const [fixPanelOpen, setFixPanelOpen] = useState(false);
  const [fixResult, setFixResult] = useState<FixResult | null>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);

  // 결과가 바뀔 때 제안 목록과 솔라 결과를 화면 전용 상태로 초기화
  useEffect(() => {
    if (!result) {
      setPendingItems([]);
      setApprovalMessage(null);
      setRefinedResult(null);
      setSolarViolations([]);
      setSolarError(null);
      setSolarDecisions({});
      setRemovedRuleKeys(new Set());
      setRuleActionError(null);
      setConfirmedItems([]);
      setFixPanelOpen(false);
      setFixResult(null);
      setAppliedNotice(null);
      return;
    }
    setPendingItems(result.proposed_additions ?? []);
    setRefinedResult(null);
    setApprovalMessage(null);
    setSolarViolations([]);
    setSolarError(null);
    setSolarDecisions({});
    setRemovedRuleKeys(new Set());
    setRuleActionError(null);
    setConfirmedItems([]);
    setFixPanelOpen(false);
    setFixResult(null);
    setAppliedNotice(null);
  }, [result]);

  const loadingMessages = [
    "원고를 읽는 중...",
    "설정집과 대조하는 중...",
    "규칙이 놓친 자리를 살피는 중...",
    "추가 제안을 분류하는 중...",
    "근거 문장을 원고에서 확인하는 중...",
    "결과를 정리하는 중...",
  ];
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);

  useEffect(() => {
    if (!reviewInProgress) {
      setLoadingMsgIndex(0);
      return;
    }
    setLoadingMsgIndex(0);
    const timer = setInterval(() => {
      setLoadingMsgIndex((prev) => {
        if (prev >= loadingMessages.length - 1) return prev;
        return prev + 1;
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [reviewInProgress]);

  const groups: Group[] = ["설정오류", "추가 제안", "판정 불가"];

  function solarKey(v: Violation): string {
    return `${v.line}-${v.subject}-${v.type}`;
  }

  function ruleKey(v: Violation): string {
    return `${v.line}-${v.subject}-${v.type}-${v.source ?? "rule"}`;
  }

  function violationKey(v: Violation): string {
    return `${v.line}-${v.subject}-${v.type}-${v.source ?? "rule"}`;
  }

  function toggleConfirmedItem(v: Violation) {
    const key = violationKey(v);
    setConfirmedItems((prev) => {
      const exists = prev.some((p) => violationKey(p) === key);
      if (exists) {
        return prev.filter((p) => violationKey(p) !== key);
      }
      return [...prev, v];
    });
  }

  async function openFixPanel() {
    if (confirmedItems.length === 0) return;
    if (!result) return;
    const manuscriptText = loadLastManuscript();
    if (!manuscriptText.trim()) {
      setFixError("저장된 원고가 없어 원고 수정을 실행할 수 없습니다.");
      return;
    }
    setFixLoading(true);
    setFixError(null);
    setFixResult(null);
    setFixPanelOpen(true);
    try {
      const res = await fetch("/api/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings_text: loadSettings(),
          manuscript_text: manuscriptText,
          confirmed_items: confirmedItems.map((v) => ({
            type: v.type,
            subject: v.subject,
            detail: v.detail,
            line: v.line,
            evidence: v.context,
            context: v.context,
          })),
        }),
      });
      const body = (await res.json()) as FixResult;
      if (!res.ok || body.errors && body.errors.length > 0) {
        setFixError(body.errors?.join("; ") ?? `원고 수정 실패 (${res.status})`);
        setFixResult(null);
        return;
      }
      setFixResult(body);
      setFixError(null);
    } catch (e) {
      setFixError(String(e));
      setFixResult(null);
    } finally {
      setFixLoading(false);
    }
  }

  const counts = groups.map((g) => ({
    group: g,
    count:
      g === "추가 제안"
        ? pendingItems.filter((p) => p.category !== "제외").length
        : g === "설정오류"
          ? (result?.violations ?? [])
              .filter(
                (v) =>
                  (v.severity === "high" || v.severity === "medium") &&
                  !removedRuleKeys.has(ruleKey(v)),
              )
              .length +
              solarViolations.filter(
                (v) => solarDecisions[solarKey(v)] !== "removed",
              ).length
          : (result?.not_checked ?? []).length,
  }));

  const handleFullReview = async () => {
    if (!result) return;
    setReviewInProgress(true);
    setReviewRefineError(null);
    setReviewConflictError(null);

    // 충돌 검사 준비가 안 되면 그 항목만 오류로 남기고 정리는 그대로 진행
    const manuscriptText = loadLastManuscript();
    const conflictReady = manuscriptText.trim().length > 0;

    await Promise.all([
      (async () => {
        if (!conflictReady) {
          setReviewConflictError("저장된 원고가 없어서 Solar 검사를 실행할 수 없습니다.");
          return;
        }
        try {
          const res = await runConflicts(
            loadSettings(),
            manuscriptText,
            result.violations ?? [],
          );
          if (res.errors && res.errors.length > 0) {
            setReviewConflictError(res.errors.join("; "));
          } else {
            setSolarViolations(res.violations ?? []);
          }
        } catch (e) {
          setReviewConflictError(String(e));
        }
      })(),
      (async () => {
        try {
          if (result.proposed_additions && result.proposed_additions.length > 0) {
            const r = await refineProposedAdditions(result.proposed_additions);
            setRefinedResult(r);
            if (r.errors.length > 0) {
              setReviewRefineError(r.errors.join("; "));
            } else if (r.after !== undefined && r.after > 0) {
              const refinedWithCategory: ProposedAddition[] = r.refined.map(
                (item) => {
                  const cat = item.refine_category;
                  const preset =
                    cat === "인물" || cat === "지명" || cat === "세계관"
                      ? (cat as PresetCategory)
                      : undefined;
                  return { ...item, category: preset };
                },
              );
              setPendingItems(refinedWithCategory);
            }
          } else {
            setRefinedResult({ refined: [], before: 0, after: 0, errors: [] });
          }
        } catch (e) {
          setReviewRefineError(String(e));
        }
      })(),
    ]);

    setReviewInProgress(false);
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">검사 결과</h2>
        {result && (
          <button
            type="button"
            onClick={handleFullReview}
            disabled={reviewInProgress}
            className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-4 py-1.5 text-sm text-white hover:bg-[var(--foreground)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {reviewInProgress ? loadingMessages[loadingMsgIndex] : "설정집 정밀 검토"}
          </button>
        )}
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

          {/* 정제 결과 요약 — 검토 실행 후 상단 표시 */}
          {result && refinedResult !== null && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">Solar로 정리</h3>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {refinedResult?.before ?? 0}건의 추가 제안을 Solar로 분류·정리했습니다.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {refinedResult?.errors.length === 0 && refinedResult?.after !== undefined && (
                    <span className="text-sm text-[var(--muted-foreground)]">
                      {refinedResult.before}건 → {refinedResult.after}건
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 검토 중 발생한 오류(정리/충돌) — 각 항목별로 독립 표시 */}
          {(reviewRefineError || reviewConflictError) && (
            <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4 text-sm">
              {reviewRefineError && (
                <div className="flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
                  <span className="font-medium text-[var(--foreground)]">정리 중 오류</span>
                  <p className="text-[var(--muted-foreground)]">{reviewRefineError}</p>
                </div>
              )}
              {reviewConflictError && (
                <div className="flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
                  <span className="font-medium text-[var(--foreground)]">Solar 설정오류 찾기 중 오류</span>
                  <p className="text-[var(--muted-foreground)]">{reviewConflictError}</p>
                </div>
              )}
            </div>
          )}

          {/* 활성 탭 콘텐츠 */}
          {activeGroup === "설정오류" && counts[0].count > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">설정오류 · {counts[0].count}건</h3>

              {ruleActionError && (
                <div className="flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-3 text-sm">
                  <span className="font-medium text-[var(--foreground)]">확인 처리 중 오류</span>
                  <p className="text-[var(--muted-foreground)]">{ruleActionError}</p>
                </div>
              )}

              {(() => {
                const ruleItems = (result?.violations ?? [])
                  .filter(
                    (v) =>
                      (v.severity === "high" || v.severity === "medium") &&
                      !removedRuleKeys.has(ruleKey(v)),
                  )
                  .sort(
                    (a, b) =>
                      (a.severity === "high" ? -1 : 1) - (b.severity === "high" ? -1 : 1),
                  );
                return ruleItems.map((v) => {
                  const key = ruleKey(v);
                  const registeredName = extractRegisteredNameFromDetail(v.detail);
                  const isPlace = registeredName ? isPlaceName(registeredName, loadSettings()) : false;
                  const aliasDisabledReason =
                    isPlace
                      ? "지명은 별칭으로 등록할 수 없습니다"
                      : registeredName
                        ? null
                        : "detail에서 등록명을 찾지 못했습니다";
                  const canEnrich =
                    !isCharacterRegistered(v.subject, loadSettings()) &&
                    (v.type === "age_conflict" || v.type === "ability_candidate");
                  return (
                    <div
                      key={key}
                      className="rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4"
                    >
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
                          {registeredName && (
                            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                              등록명: {registeredName}
                            </p>
                          )}
                          <pre className="mt-2 max-w-full overflow-auto rounded border border-[var(--border)] bg-[var(--card)] p-2 text-[11px] leading-relaxed text-[var(--muted-foreground)] whitespace-pre-wrap break-words">
                            {v.context}
                          </pre>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            toggleConfirmedItem(v);
                          }}
                          className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--foreground)] transition-colors"
                        >
                          확정
                        </button>
                        {registeredName && !isPlace && (
                          <button
                            type="button"
                            disabled={!v.subject.trim()}
                            onClick={async () => {
                              if (!v.subject.trim()) return;
                              try {
                                const updated = registerAlias(v.subject, registeredName, loadSettings());
                                saveSettings(updated.updated);
                                setRemovedRuleKeys((prev) => new Set(prev).add(key));
                              } catch (e) {
                                setRuleActionError(String(e));
                              }
                            }}
                            className={`rounded-md border px-3 py-1 text-xs font-medium text-white transition-colors ${
                              !v.subject.trim()
                                ? "bg-[var(--muted)]/40 border-[var(--border)] text-[var(--muted-foreground)] cursor-not-allowed"
                                : "bg-[var(--accent)] border-[var(--accent)] hover:bg-[var(--foreground)]"
                            }`}
                          >
                            별칭 등록
                          </button>
                        )}
                        {canEnrich && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const settings = loadSettings();
                                const item: ProposedAddition = {
                                  name: v.subject,
                                  count: 1,
                                  first_line: v.line,
                                  context: v.context,
                                  note: v.detail,
                                  category: "인물",
                                };
                                await approveAndEnrich([item], settings, loadLastManuscript());
                                setRemovedRuleKeys((prev) => new Set(prev).add(key));
                              } catch (e) {
                                console.error("[Solar 추가] 실패:", e);
                              }
                            }}
                            className="rounded-md border border-[var(--primary)] bg-[var(--primary)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--foreground)] transition-colors"
                          >
                            설정집에 추가
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setRemovedRuleKeys((prev) => new Set(prev).add(key));
                          }}
                          className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                        >
                          제거
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}

              {solarViolations
                .filter((v) => solarDecisions[solarKey(v)] !== "removed")
                .map((v, idx) => {
                  const key = solarKey(v);
                  const decision = solarDecisions[key];
                  const pending = decision === "pending" || decision === undefined;
                  const registeredName = extractRegisteredNameFromDetail(v.detail);
                  const isPlace = registeredName ? isPlaceName(registeredName, loadSettings()) : false;
                  const canEnrich =
                    !isCharacterRegistered(v.subject, loadSettings()) &&
                    (v.type === "age_conflict" || v.type === "ability_candidate");
                  return (
                    <div
                      key={`solar-${key}-${idx}`}
                      className="rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="rounded border border-[var(--accent)] bg-[var(--accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--accent)] uppercase tracking-wide">
                              Solar
                            </span>
                          </div>
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
                          {pending && (
                            <p className="mt-2 text-xs text-[var(--muted-foreground)] italic">
                              확정 전입니다. 맞으면 확정을, 틀리면 제거를 누르세요.
                            </p>
                          )}
                        </div>
                        {pending && (
                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                toggleConfirmedItem(v);
                                setSolarDecisions((prev) => ({
                                  ...prev,
                                  [key]: "confirmed",
                                }));
                              }}
                              className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--foreground)] transition-colors"
                            >
                              확정
                            </button>
                            {registeredName && !isPlace && (
                              <button
                                type="button"
                                disabled={!v.subject.trim()}
                                onClick={async () => {
                                  if (!v.subject.trim()) return;
                                  try {
                                    const updated = registerAlias(v.subject, registeredName, loadSettings());
                                    saveSettings(updated.updated);
                                    setSolarDecisions((prev) => ({
                                      ...prev,
                                      [key]: "removed",
                                    }));
                                  } catch (e) {
                                    setRuleActionError(String(e));
                                  }
                                }}
                                className={`rounded-md border px-3 py-1 text-xs font-medium text-white transition-colors ${
                                  !v.subject.trim()
                                    ? "bg-[var(--muted)]/40 border-[var(--border)] text-[var(--muted-foreground)] cursor-not-allowed"
                                    : "bg-[var(--accent)] border-[var(--accent)] hover:bg-[var(--foreground)]"
                                }`}
                              >
                                별칭 등록
                              </button>
                            )}
                            {canEnrich && (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const settings = loadSettings();
                                    const item: ProposedAddition = {
                                      name: v.subject,
                                      count: 1,
                                      first_line: v.line,
                                      context: v.context,
                                      note: v.detail,
                                      category: "인물",
                                    };
                                    await approveAndEnrich([item], settings, loadLastManuscript());
                                    setSolarDecisions((prev) => ({
                                      ...prev,
                                      [key]: "removed",
                                    }));
                                  } catch (e) {
                                    console.error("[Solar 추가] 실패:", e);
                                  }
                                }}
                                className="rounded-md border border-[var(--primary)] bg-[var(--primary)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--foreground)] transition-colors"
                              >
                                설정집에 추가
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setSolarDecisions((prev) => ({
                                  ...prev,
                                  [key]: "removed",
                                }));
                                setConfirmedItems((prev) =>
                                  prev.filter((p) => violationKey(p) !== key)
                                );
                              }}
                              className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                            >
                              제거
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {activeGroup === "추가 제안" && counts[1].count > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">
                추가 제안 · {counts[1].count}건
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
                    onClick={async () => {
                      const resultOfApproval = await approveAndEnrich(
                        pendingItems,
                        loadStored(),
                        loadLastManuscript(),
                      );
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
                      setPendingItems(
                        prev => prev.filter((p) => !p.category)
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

          {/* 원고 수정 결과 패널 */}
          {fixPanelOpen && fixResult && (
            <div className="flex flex-col gap-4 rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  Solar 수정 결과 · {fixResult.changes.length}건
                </h3>
                <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
                  <span>확정 {fixResult.summary.confirmed_count}건</span>
                  <span>수정본 {fixResult.summary.revised_length}자</span>
                </div>
              </div>

              {fixResult.changes.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {fixResult.changes.map((ch) => (
                    <div key={ch.item_index} className="rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{ch.subject}</span>
                        <span className="text-xs text-[var(--muted-foreground)]">
                          #{ch.item_index + 1}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1 text-sm">
                        <p className="text-[var(--muted-foreground)]">{ch.change_description}</p>
                        {ch.original_snippet && (
                          <p className="text-xs text-[var(--muted-foreground)]">
                            원본: {ch.original_snippet}
                          </p>
                        )}
                        {ch.revised_snippet && (
                          <p className="text-xs text-[var(--accent)]">
                            수정: {ch.revised_snippet}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">
                  확정된 항목에 대해 원고가 수정되었습니다. 변경된 표현이 없으면 이 메시지가 표시됩니다.
                </p>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const manuscript = fixResult.revised_manuscript;
                    saveLastManuscript(manuscript);
                    if (onManuscriptChange) {
                      onManuscriptChange(manuscript);
                    }
                    setConfirmedItems([]);
                    setAppliedNotice(`원고가 바뀌었으니 다시 검사하세요.`);
                    setFixPanelOpen(false);
                    setFixResult(null);
                  }}
                  className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--foreground)] transition-colors"
                >
                  적용
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFixPanelOpen(false);
                    setFixResult(null);
                    setAppliedNotice(null);
                  }}
                  className="rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-1.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          )}

          {activeGroup === "판정 불가" && counts[2].count > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">판정 불가 · {counts[2].count}건</h3>
              <ul className="flex flex-col gap-2 text-sm text-[var(--muted-foreground)]">
                {((result?.not_checked ?? []) as string[]).map((item) => (
                  <li key={item}>
                    {item === "age"
                      ? "나이는 설정집에 나이가 적힌 인물이 없어 대조하지 못했습니다"
                      : item === "ability"
                        ? "능력은 설정집에 '불가'로 적힌 능력이 있는 인물이 없어 대조하지 못했습니다"
                        : item === "timeline"
                          ? "시간선은 원고에 나온 시간선이 2개 미만이라 순서를 대조하지 못했습니다"
                          : `${item}를 검사하지 못했습니다`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {fixError && (
            <div className="flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-3 text-sm">
              <span className="font-medium text-[var(--foreground)]">원고 수정 중 오류</span>
              <p className="text-[var(--muted-foreground)]">{fixError}</p>
            </div>
          )}

          {appliedNotice && (
            <div className="flex flex-col gap-1 rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-3 text-sm">
              <span className="font-medium text-[var(--foreground)]">반영 완료</span>
              <p className="text-[var(--muted-foreground)]">{appliedNotice}</p>
            </div>
          )}

          {fixError && (
            <div className="flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-3 text-sm">
              <span className="font-medium text-[var(--foreground)]">원고 수정 중 오류</span>
              <p className="text-[var(--muted-foreground)]">{fixError}</p>
            </div>
          )}

          {appliedNotice && (
            <div className="flex flex-col gap-1 rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-3 text-sm">
              <span className="font-medium text-[var(--foreground)]">반영 완료</span>
              <p className="text-[var(--muted-foreground)]">{appliedNotice}</p>
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
