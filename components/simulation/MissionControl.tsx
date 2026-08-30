"use client";

import { SimulationProvider } from "./SimulationProvider";
import { MapViewport } from "@/components/map/MapViewport";
import { BuildingInspector } from "@/components/map/BuildingInspector";
import { Header } from "@/components/ui/Header";
import { TimeScrubber } from "@/components/ui/TimeScrubber";
import { HospitalBoard } from "@/components/ui/HospitalBoard";
import { CriticalList } from "@/components/ui/CriticalList";
import { ExportReport } from "@/components/ui/ExportReport";
import { PolicyDrawer } from "@/components/simulation/PolicyDrawer";
import { HudOverlays } from "@/components/assets/HudOverlays";

export function MissionControl() {
  return (
    <SimulationProvider>
      <div className="relative h-screen w-screen overflow-hidden bg-[#05070c] text-slate-100">
        <MapViewport />
        <HudOverlays />
        <Header />
        <HospitalBoard />
        <PolicyDrawer />
        <CriticalList />
        <BuildingInspector />
        <TimeScrubber />
        <div className="pointer-events-none absolute right-4 top-[7.5rem] z-30 md:top-[8.25rem]">
          <div className="pointer-events-auto">
            <ExportReport />
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-3 right-4 z-10 hidden text-[10px] text-slate-500 md:block">
          Synthetic morphology · not an official HKO / HA feed
        </div>
      </div>
    </SimulationProvider>
  );
}
