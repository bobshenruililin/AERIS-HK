"use client";

import type { ReactNode } from "react";
import { AERIS_TOKENS } from "@/lib/tokens";
import { cn } from "@/lib/utils";

interface GlassPanelProps {
  className?: string;
  children: ReactNode;
  padded?: boolean;
}

export function GlassPanel({ className, children, padded = true }: GlassPanelProps) {
  return (
    <div
      className={cn(
        "pointer-events-auto rounded-2xl border border-cyan-300/20 shadow-[0_0_40px_rgba(8,145,178,0.12)] backdrop-blur-xl",
        padded && "p-3 md:p-4",
        className,
      )}
      style={{
        backgroundColor: AERIS_TOKENS.color.glass,
        fontFamily: AERIS_TOKENS.type.display,
      }}
    >
      {children}
    </div>
  );
}
