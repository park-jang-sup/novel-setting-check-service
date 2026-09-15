"use client";

import { useState, useCallback } from "react";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ManuscriptInput } from "@/components/ManuscriptInput";
import { ResultsPanel } from "@/components/ResultsPanel";
import { CoveragePanel } from "@/components/CoveragePanel";
import { runCheck } from "@/app/utils/parser";
import { loadSettings, saveSettings, saveLastManuscript, clearEpisodeRuns } from "@/app/utils/storage";
import {
  saveLastResult,
  loadCurrentEpisodeLabel,
  saveCurrentEpisodeLabel,
  saveEpisodeRun,
  EpisodeRun,
} from "@/app/utils/storage";
import { CheckResult } from "@/app/utils/types";

const WORKS = [
  { label: "판타지", settings: "/samples/fantasy_settings.md", episodes: [
    { label: "1화", manuscript: "/samples/fantasy_manuscript.txt", fillSettings: true },
    { label: "2화", manuscript: "/samples/fantasy_manuscript2.txt", fillSettings: false },
  ]},
  { label: "현대판타지", settings: "/samples/modern_fantasy_settings.md", episodes: [
    { label: "1화", manuscript: "/samples/modern_fantasy_manuscript.txt", fillSettings: true },
  ]},
  { label: "무협", settings: "/samples/martial_settings.md", episodes: [
    { label: "1화", manuscript: "/samples/martial_manuscript.txt", fillSettings: true },
  ]},
  { label: "예선", settings: "/samples/prelim_settings.md", episodes: [
    { label: "1화", manuscript: "/samples/prelim_manuscript.txt", fillSettings: true },
  ]},
];

type Episode = (typeof WORKS)[number]["episodes"][number];

async function loadEpisode(work: (typeof WORKS)[number], episode: Episode, setManuscript: (v: string) => void) {
  if (episode.fillSettings) {
    const [settingsRes, manuscriptRes] = await Promise.all([
      fetch(work.settings),
      fetch(episode.manuscript),
    ]);
    if (!settingsRes.ok || !manuscriptRes.ok) {
      throw new Error("샘플 파일을 불러오지 못했습니다");
    }
    const settingsText = (await settingsRes.text());
    const manuscriptText = (await manuscriptRes.text());
    const currentSettings = loadSettings();
    if (currentSettings !== settingsText) {
      clearEpisodeRuns();
    }
    saveSettings(settingsText);
    window.dispatchEvent(new CustomEvent("settings-changed"));
    saveLastManuscript(manuscriptText);
    setManuscript(manuscriptText);
  } else {
    const res = await fetch(episode.manuscript);
    if (!res.ok) {
      throw new Error("원고 파일을 불러오지 못했습니다");
    }
    const manuscriptText = (await res.text());
    saveLastManuscript(manuscriptText);
    setManuscript(manuscriptText);
  }
  saveCurrentEpisodeLabel(episode.label);
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
  const [isOpen, setIsOpen] = useState<string | null>(null);
  const [currentEpisodeNumber, setCurrentEpisodeNumber] = useState<string>("");
  const [currentWorkLabel, setCurrentWorkLabel] = useState<string>("");

  const handleRun = async () => {
    if (!manuscript.trim()) return;
    setResult(null);
    const settings = loadSettings();
    const data = await runCheck(settings, manuscript);
    setResult(data);
    saveLastResult(data);

    const savedLabel = loadCurrentEpisodeLabel();
    const number = currentEpisodeNumber.trim();
    const label =
      (number ? `${number}화` : "") || savedLabel || "";
    if (label) {
      saveCurrentEpisodeLabel(label);
      const summary = data.summary;
      const run: EpisodeRun = {
        label,
        checkedAt: Date.now(),
        errorsTotal: summary.high,
        mediumTotal: summary.medium,
        proposed: summary.proposed,
        approvedAdded: 0,
        approvedSkipped: 0,
        excluded: 0,
      };
      saveEpisodeRun(run);
      window.dispatchEvent(new CustomEvent("episode-runs-updated"));
    }
  };

  const handleLoadEpisode = useCallback(
    async (work: (typeof WORKS)[number], episode: Episode) => {
      try {
        await loadEpisode(work, episode, setManuscript);
        setResult(null);
        setCurrentEpisodeNumber(episode.label.replace("화", ""));
        setCurrentWorkLabel(work.label);
      } catch (e) {
        console.error("[Home] 에피소드 로드 실패", e);
      }
    },
    [setManuscript],
  );

  return (
    <main className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 max-w-7xl mx-auto">
      <section className="flex flex-col gap-4">
        <SettingsPanel />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 flex flex-col gap-3">
          <h2 className="text-lg font-semibold">데모 샘플</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            버튼을 누르면 설정집과 회차가 한 번에 채워집니다. 검사하려면 아래 원고창에서 검사하기를 누르세요.
          </p>
          <div className="flex flex-col gap-3">
            <div className="flex items-center">
              <h3 className="text-sm font-medium text-[var(--foreground)]">
                {currentWorkLabel ? (
                  <span className="text-[var(--accent)]">
                    현재 불러온 샘플: {currentWorkLabel} {currentEpisodeNumber ? currentEpisodeNumber + "화" : ""}
                  </span>
                ) : (
                  <span className="text-[var(--muted-foreground)]">아무 샘플도 불러오지 않았습니다</span>
                )}
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {WORKS.map((w) => (
                <div key={w.label} className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(w.label);
                    }}
                    className="rounded-lg border px-4 py-2 text-sm font-medium border-[var(--border)] bg-[var(--card)]/80 hover:border-[var(--accent)] hover:bg-[var(--card)]"
                  >
                    {w.label}
                  </button>
                  {isOpen === w.label && (
                    <div className="flex flex-col gap-2">
                      {w.episodes.map((ep) => {
                        const isCurrent = currentWorkLabel === w.label
                          && currentEpisodeNumber === ep.label.replace("화", "");
                        return (
                          <button
                            key={ep.label}
                            type="button"
                            onClick={() => handleLoadEpisode(w, ep)}
                            className={`w-full rounded-lg border px-4 py-2 text-sm font-medium ${
                              isCurrent
                                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20"
                                : "border-[var(--border)] bg-[var(--card)]/80 hover:border-[var(--accent)] hover:bg-[var(--card)]"
                            }`}
                          >
                            {ep.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <ManuscriptInput
          manuscript={manuscript}
          setManuscript={setManuscript}
          onRun={handleRun}
          currentEpisodeNumber={currentEpisodeNumber}
          onEpisodeNumberChange={setCurrentEpisodeNumber}
        />
        <ResultsPanel result={result} />
        <CoveragePanel />
      </section>
    </main>
  );
}
