"use client";

import { useMemo } from "react";
import { loadSettings } from "@/app/utils/storage";

function parseCounts(settingsRaw: string) {
  const characters = settingsRaw
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("## ")) // ## 인물명
    .map((l) => l.trim().replace(/^##\s+/, ""));

  const locationLines = settingsRaw
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("- ") && settingsRaw.includes("# 지명"))
    .filter((l) => {
      const idx = settingsRaw.indexOf("# 지명");
      const after = settingsRaw.slice(idx);
      return after.startsWith(l.trim());
    });

  // 지명 섹션 아래 "- 값"만 센다
  const 지명섹션인덱스 = settingsRaw.indexOf("# 지명");
  let 지명 = 0;
  if (지명섹션인덱스 !== -1) {
    const 나머지 = settingsRaw.slice(지명섹션인덱스 + "# 지명".length);
    const 끝 = 나머지.indexOf("# ");
    const 구역 = 끝 === -1 ? 나머지 : 나머지.slice(0, 끝);
    지명 = 구역.split(/\r?\n/).filter((l) => l.trim().startsWith("- ")).length;
  }

  // 시간선은 "# 시간선" 아래 번호 항목만 센다
  const 시간선섹션인덱스 = settingsRaw.indexOf("# 시간선");
  let 시간선 = 0;
  if (시간선섹션인덱스 !== -1) {
    const 나머지 = settingsRaw.slice(시간선섹션인덱스 + "# 시간선".length);
    const 끝 = 나머지.indexOf("# ");
    const 구역 = 끝 === -1 ? 나머지 : 나머지.slice(0, 끝);
    시간선 = 구역.split(/\r?\n/).filter((l) => /^\d+\./.test(l.trim())).length;
  }

  return {
    인물: characters.length,
    지명,
    시간선,
  };
}

export function CoveragePanel() {
  const settingsRaw = loadSettings();
  const counts = useMemo(() => parseCounts(settingsRaw), [settingsRaw]);

  const hasData = counts.인물 > 0 || counts.지명 > 0 || counts.시간선 > 0;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 flex flex-col gap-4">
      <h2 className="text-lg font-semibold">커버리지</h2>

      <div className="flex flex-wrap gap-4 rounded-lg border border-[var(--border)] bg-[var(--card)]/80 p-4 text-sm">
        <span className="font-medium">대조 {counts.인물}명 {counts.지명}곳 시간선 {counts.시간선}건</span>
      </div>

      {!hasData && (
        <p className="text-sm text-[var(--muted-foreground)]">
          아직 설정집이 비어 있습니다. 회차 원고를 넣어 추가제안 목록을 만든 뒤, 승인한 항목을 설정집에 추가하면 여기 표시됩니다.
        </p>
      )}

      {hasData && (
        <p className="text-sm text-[var(--muted-foreground)]">
          설정집에 인물 {counts.인물}명, 지명 {counts.지명}곳, 시간선 {counts.시간선}건이 저장되어 있습니다.
        </p>
      )}
    </section>
  );
}
