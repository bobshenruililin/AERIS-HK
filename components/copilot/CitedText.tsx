"use client";

import { splitCitedText, type CitationSpec } from "@/lib/agent";

export function CitedText({
  text,
  onCite,
}: {
  text: string;
  onCite: (spec: CitationSpec) => void;
}) {
  const parts = splitCitedText(text);
  return (
    <span>
      {parts.map((part, i) =>
        part.type === "cite" ? (
          <button
            key={`${part.value}-${i}`}
            type="button"
            data-testid={part.spec ? `citation-${part.spec.id}` : `citation-unknown-${i}`}
            data-citation={part.spec?.highlight ?? undefined}
            title={part.spec ? `${part.spec.equation} · ${part.spec.module}` : part.value}
            className="mx-0.5 inline rounded-sm bg-amber-400/15 px-1 font-mono text-[10px] text-amber-100 underline decoration-amber-300/70 underline-offset-2 hover:bg-amber-400/30"
            onClick={() => {
              if (part.spec) onCite(part.spec);
            }}
          >
            {part.value}
          </button>
        ) : (
          <span key={`t-${i}`}>{part.value}</span>
        ),
      )}
    </span>
  );
}
