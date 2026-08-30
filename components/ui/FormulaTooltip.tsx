"use client";

import type { ReactNode } from "react";
import { FORMULAS, type FormulaId } from "@/lib/formulas";
import { cn } from "@/lib/utils";

export function FormulaPopover({
  id,
  tone = "dark",
}: {
  id: FormulaId;
  tone?: "dark" | "light";
}) {
  const f = FORMULAS[id];
  return (
    <span
      role="tooltip"
      className={cn(
        "pointer-events-none invisible absolute left-0 top-[calc(100%+6px)] z-[80] w-72 rounded-lg p-2 text-left text-[10px] leading-relaxed opacity-0 shadow-xl",
        "group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100",
        tone === "light"
          ? "border border-slate-300 bg-white text-slate-800"
          : "border border-cyan-300/25 bg-slate-950/95 text-cyan-50",
      )}
    >
      <span
        className={cn(
          "block text-[9px] uppercase tracking-[0.14em]",
          tone === "light" ? "text-slate-500" : "text-cyan-300/80",
        )}
      >
        {f.name}
      </span>
      <span
        className={cn(
          "mt-1 block font-mono text-[10px]",
          tone === "light" ? "text-slate-800" : "text-amber-100/90",
        )}
      >
        {f.identity}
      </span>
      <span className={cn("mt-1 block", tone === "light" ? "text-slate-500" : "text-slate-400")}>
        {f.note}
      </span>
    </span>
  );
}

/**
 * Hover + keyboard-focus micro-tooltip quoting the exact engine identity.
 * Use `interactive={false}` inside another button (HudPill) so we do not nest
 * tab stops — the parent button is the focus target.
 */
export function FormulaTip({
  id,
  children,
  className,
  tone = "dark",
  interactive = true,
}: {
  id: FormulaId;
  children?: ReactNode;
  className?: string;
  tone?: "dark" | "light";
  interactive?: boolean;
}) {
  return (
    <span
      className={cn("group/tip relative inline-flex items-center", className)}
      data-testid={`formula-tip-${id}`}
      tabIndex={interactive ? 0 : undefined}
    >
      {children}
      <span className="ml-0.5 font-mono text-[9px] text-cyan-400/70" aria-hidden>
        ƒ
      </span>
      <span className="sr-only">
        {FORMULAS[id].name}: {FORMULAS[id].identity}
      </span>
      <FormulaPopover id={id} tone={tone} />
    </span>
  );
}
