"use client";

import { useState } from "react";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ManuscriptInput } from "@/components/ManuscriptInput";
import { ResultsPanel } from "@/components/ResultsPanel";
import { CoveragePanel } from "@/components/CoveragePanel";
import { runCheck } from "@/app/utils/parser";
import { loadSettings } from "@/app/utils/storage";
import { saveLastResult } from "@/app/utils/storage";
import { CheckResult } from "@/app/utils/types";

export default function Home() {
  const [manuscript, setManuscript] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);

  const handleRun = () => {
    if (!manuscript.trim()) return;
    const settings = loadSettings();
    const data = runCheck(settings, manuscript);
    setResult(data);
    saveLastResult(data);
  };

  return (
    <main className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 max-w-7xl mx-auto">
      <section className="flex flex-col gap-4">
        <SettingsPanel />
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
