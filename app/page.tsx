"use client";

import { useState, useCallback } from "react";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ManuscriptInput } from "@/components/ManuscriptInput";
import { ResultsPanel } from "@/components/ResultsPanel";
import { CoveragePanel } from "@/components/CoveragePanel";
import { runCheck } from "@/app/utils/parser";
import { loadSettings, saveSettings, saveLastManuscript } from "@/app/utils/storage";
import { saveLastResult } from "@/app/utils/storage";
import { CheckResult } from "@/app/utils/types";

const SAMPLES = [
  { label: "판타지", settings: "/samples/fantasy_settings.md", manuscript: "/samples/fantasy_manuscript.txt" },
  { label: "현대판타지", settings: "/samples/modern_fantasy_settings.md", manuscript: "/samples/modern_fantasy_manuscript.txt" },
  { label: "무협", settings: "/samples/martial_settings.md", manuscript: "/samples/martial_manuscript.txt" },
  { label: "예선", settings: "/samples/prelim_settings.md", manuscript: "/samples/prelim_manuscript.txt" },
];

async function loadSample(sample: (typeof SAMPLES)[number], setManuscript: (v: string) => void) {
  const [settingsRes, manuscriptRes] = await Promise.all([
    fetch(sample.settings),
    fetch(sample.manuscript),
  ]);

  if (!settingsRes.ok || !manuscriptRes.ok) {
    throw new Error("샘플 파일을 불러오지 못했습니다");
  }

  const settingsText = (await settingsRes.text());
  const manuscriptText = (await manuscriptRes.text());

  saveSettings(settingsText);
  saveLastManuscript(manuscriptText);
  window.dispatchEvent(new CustomEvent("settings-changed"));
  setManuscript(manuscriptText);
}

async function loadEpisodeManuscript(
  manuscriptPath: string,
  setManuscript: (v: string) => void,
) {
  const res = await fetch(manuscriptPath);
  if (!res.ok) {
    throw new Error("원고 파일을 불러오지 못했습니다");
  }
  const manuscriptText = (await res.text());
  saveLastManuscript(manuscriptText);
  setManuscript(manuscriptText);
}

export default function Home() {
  const [manuscript, setManuscript] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);

  const handleRun = async () => {
    if (!manuscript.trim()) return;
    setResult(null);
    const settings = loadSettings();
    const data = await runCheck(settings, manuscript);
    setResult(data);
    saveLastResult(data);
  };

  const handleLoadSample = useCallback(
    async (sample: (typeof SAMPLES)[number]) => {
      try {
        await loadSample(sample, setManuscript);
      } catch (e) {
        console.error("[Home] 샘플 로드 실패", e);
      }
    },
    [setManuscript],
  );

  const handleLoadEpisode2 = useCallback(async () => {
    try {
      await loadEpisodeManuscript("/samples/fantasy_manuscript2.txt", setManuscript);
    } catch (e) {
      console.error("[Home] 2화 원고 로드 실패", e);
    }
  }, [setManuscript]);

  return (
    <main className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 max-w-7xl mx-auto">
      <section className="flex flex-col gap-4">
        <SettingsPanel />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 flex flex-col gap-3">
          <h2 className="text-lg font-semibold">데모 샘플</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            버튼을 누르면 설정집과 회차가 한 번에 채워집니다. 검사하려면 아래 원고창에서 검사하기를 누르세요.
          </p>
          <div className="flex flex-wrap gap-2">
            {SAMPLES.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => handleLoadSample(s)}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)]/80 px-4 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--card)] hover:border-[var(--accent)]"
              >
                {s.label}
              </button>
            ))}
            <div className="w-px bg-[var(--border)] self-stretch" />
            <button
              type="button"
              onClick={handleLoadEpisode2}
              className="rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-2 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20"
            >
            판타지 2화
            </button>
          </div>
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <ManuscriptInput
          manuscript={manuscript}
          setManuscript={setManuscript}
          onRun={handleRun}
        />
        <ResultsPanel result={result} />
        <CoveragePanel />
      </section>
    </main>
  );
}
