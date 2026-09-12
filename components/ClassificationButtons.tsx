"use client";

import { PresetCategory } from "@/app/utils/types";

interface Props {
  value?: PresetCategory;
  onChange: (category: PresetCategory) => void;
}

const OPTIONS: { value: PresetCategory; label: string }[] = [
  { value: "인물", label: "인물" },
  { value: "지명", label: "지명" },
  { value: "세계관", label: "세계관" },
  { value: "제외", label: "제외" },
];

export function ClassificationButtons({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-md border px-3 py-1 text-sm transition-colors ${
            value === opt.value
              ? "border-[var(--accent)] bg-[var(--accent)] text-white"
              : "border-[var(--border)] bg-[var(--card)]/80 text-[var(--foreground)] hover:bg-[var(--card)]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
