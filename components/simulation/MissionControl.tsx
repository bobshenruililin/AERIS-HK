"use client";

import { SimulationProvider } from "./SimulationProvider";
import { MapViewport } from "@/components/map/MapViewport";
import { BuildingInspector } from "@/components/map/BuildingInspector";
import { Header } from "@/components/ui/Header";
import { TimeScrubber } from "@/components/ui/TimeScrubber";
import { HospitalBoard } from "@/components/ui/HospitalBoard";
import { CriticalList } from "@/components/ui/CriticalList";
import { PolicyDrawer } from "@/components/simulation/PolicyDrawer";
import { HudOverlays } from "@/components/assets/HudOverlays";
import { DecadeObservatory } from "@/components/ui/DecadeObservatory";
import { ControlDock } from "@/components/ui/ControlDock";
import { LiveOpsToggle } from "@/components/ui/LiveOpsToggle";
import { CommandPalette, HudHotkeys } from "@/components/ui/CommandPalette";
import { PolicyAgent } from "@/components/copilot/PolicyAgent";
import { CinematicDirector } from "@/components/presentation/CinematicDirector";
import { SystemHealthOverlay } from "@/components/dev/SystemHealthOverlay";
import { ClientOnly } from "@/components/system/ClientOnly";
import { ErrorBoundary } from "@/components/system/ErrorBoundary";
import { MissionShell } from "@/components/system/MissionShell";

export function MissionControl() {
  return (
    <ClientOnly fallback={<MissionShell />}>
      <ErrorBoundary fallback={<MissionShell label="AERIS-HK · HUD contained" />}>
        <SimulationProvider>
          <div
            className="relative h-screen w-screen overflow-hidden bg-[#05070c] text-slate-100"
            data-testid="hud-ready"
          >
            <MapViewport />
            <HudOverlays />
            <div className="aeris-earth-chrome pointer-events-none absolute inset-0 z-20">
              <ControlDock />
              <LiveOpsToggle />
              <Header />
              <HospitalBoard />
              <PolicyDrawer />
              <CriticalList />
              <DecadeObservatory />
              <TimeScrubber />
              <div className="pointer-events-none absolute bottom-3 right-4 z-10 hidden text-[10px] text-slate-500 md:block">
                Synthetic morphology · live HKO + HA aggregates · not an official product
              </div>
            </div>
            <BuildingInspector />
            <CommandPalette />
            <HudHotkeys />
            <PolicyAgent />
            <CinematicDirector />
            <SystemHealthOverlay />
          </div>
        </SimulationProvider>
      </ErrorBoundary>
    </ClientOnly>
  );
}
