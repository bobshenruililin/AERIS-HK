"use client";

import type { ReactNode } from "react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import type { CitationHighlight } from "@/lib/agent";
import { cn } from "@/lib/utils";

export function useCitationPulse(highlight: CitationHighlight, className?: string): string {
  const { copilot } = useSimulation();
  const on = copilot.citationHighlight === highlight;
  return cn(className, on && "aeris-cite-hit");
}

export function CitationMark({
  highlight,
  children,
  className,
  testId,
  block = false,
}: {
  highlight: CitationHighlight;
  children: ReactNode;
  className?: string;
  testId?: string;
  block?: boolean;
}) {
  const pulse = useCitationPulse(highlight);
  const props = {
    "data-citation": highlight,
    "data-testid": testId,
    className: cn(pulse, className),
  };
  if (block) {
    return <div {...props}>{children}</div>;
  }
  return <span {...props}>{children}</span>;
}
