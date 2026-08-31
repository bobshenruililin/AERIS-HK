import type { Metadata } from "next";
import { MissionControl } from "@/components/simulation/MissionControl";

export const metadata: Metadata = {
  title: "Earth · AERIS-HK · 九龍西",
  description:
    "Click to enter a living thermal Earth of Kowloon West — ISO 7243 WBGT, Gagge two-node physiology, and Hospital Authority M/M/c surge on the July 2022 plate.",
  openGraph: {
    title: "AERIS Earth · Kowloon West",
    description: "Organize the city's thermal truth. 把一座城市的熱真實，做成可查詢的地球。",
  },
};

export default function EarthPage() {
  return <MissionControl />;
}
