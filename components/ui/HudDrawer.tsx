"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import type { DrawerId } from "@/lib/hud";
import { cn } from "@/lib/utils";
import { FormulaPopover } from "./FormulaTooltip";
import { FORMULAS, type FormulaId } from "@/lib/formulas";

export function MiniSpark({
  values,
  className,
  color = "#67e8f9",
}: {
  values: number[];
  className?: string;
  color?: string;
}) {
  const max = Math.max(1, ...values);
  const pts = values
    .map((v, i) => {
      const x = values.length <= 1 ? 0 : (i / (values.length - 1)) * 48;
      const y = 14 - (v / max) * 12;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 48 16" className={cn("h-3.5 w-12", className)} aria-hidden>
      <polyline fill="none" stroke={color} strokeWidth="1.4" points={pts} />
    </svg>
  );
}

export function HudPill({
  label,
  value,
  spark,
  onClick,
  testId,
  formulaId,
}: {
  label: string;
  value: string;
  spark?: number[];
  onClick: () => void;
  testId?: string;
  formulaId?: FormulaId;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="group/tip pointer-events-auto relative flex items-center gap-2 rounded-full border border-cyan-300/25 bg-slate-950/70 px-3 py-1.5 text-left shadow-[0_0_24px_rgba(8,145,178,0.18)] backdrop-blur-xl hover:border-cyan-200/50"
    >
      <span className="text-[9px] uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <span className="font-mono text-[11px] text-cyan-100">{value}</span>
      {spark && spark.length > 1 ? <MiniSpark values={spark} /> : null}
      {formulaId ? (
        <>
          <span className="font-mono text-[9px] text-cyan-400/70" aria-hidden>
            ƒ
          </span>
          <span data-testid={`formula-tip-${formulaId}`} className="sr-only">
            {FORMULAS[formulaId].name}: {FORMULAS[formulaId].identity}
          </span>
          <FormulaPopover id={formulaId} />
        </>
      ) : null}
    </button>
  );
}

export function HudDrawer({
  drawerId,
  pill,
  className,
  children,
}: {
  drawerId: DrawerId;
  pill: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { isDrawerExpanded, toggleDrawer } = useSimulation();
  const expanded = isDrawerExpanded(drawerId);

  return (
    <div className={cn("pointer-events-none z-20", className)}>
      <AnimatePresence initial={false}>
        {!expanded ? (
          <motion.div
            key="pill"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="pointer-events-auto"
            onMouseEnter={() => toggleDrawer(drawerId)}
          >
            {pill}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <motion.div
        initial={false}
        animate={{
          height: expanded ? "auto" : 0,
          opacity: expanded ? 1 : 0,
        }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className={expanded ? "overflow-visible" : "overflow-hidden"}
        aria-hidden={!expanded}
      >
        {children}
      </motion.div>
    </div>
  );
}
