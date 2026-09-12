"use client";

import { saveLastManuscript } from "@/app/utils/storage";

export function ManuscriptInput({
  manuscript,
  setManuscript,
  onRun,
}: {
  manuscript: string;
  setManuscript: (v: string) => void;
  onRun: () => void;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setManuscript(e.target.value);
  };

  const handleBlur = () => {
    saveLastManuscript(manuscript);
  };

  const handleClear = () => {
    setManuscript("");
    saveLastManuscript("");
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">회차 원고</h2>
        <button
          type="button"
          onClick={handleClear}
          className="text-sm text-[var(--muted-foreground)] underline underline-offset-2 hover:no-underline"
        >
          지우기
        </button>
      </div>

      <textarea
        value={manuscript}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="새 회차 원고를 붙여넣으세요. 한 회차를 넣을 때마다 한 번씩 입력합니다."
        className="flex-1 min-h-[180px] resize-y rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-3 text-sm leading-relaxed text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
      />

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            console.log("[ManuscriptInput] 검사하기 클릭", manuscript.trim().length, "자");
            onRun();
          }}
          disabled={!manuscript.trim()}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:bg-[var(--muted)] disabled:text-[var(--muted-foreground)] disabled:border disabled:border-[var(--border)] disabled:cursor-not-allowed hover:bg-[var(--primary)]/90"
        >
          검사하기
        </button>

        <div className="flex items-center justify-between text-sm text-[var(--muted-foreground)]">
          <span> 입력한 글자 수: {manuscript.length.toLocaleString()}자</span>
          <span>한 회차를 넣을 때마다 한 번씩 입력합니다.</span>
        </div>
      </div>
    </section>
  );
}
