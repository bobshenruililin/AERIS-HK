import type { SystemHourSnapshot } from "../types";
import type { HourlyClusterMetricDto } from "./types";
import { isHospitalCluster } from "./types";

export function clusterMetricsFromSnapshot(
  snapshot: SystemHourSnapshot,
  dayIso = "2022-07-19",
): HourlyClusterMetricDto[] {
  const hour = Math.floor(snapshot.hour) % 24;
  const timestamp = `${dayIso}T${String(hour).padStart(2, "0")}:00:00+08:00`;
  return snapshot.hospitals.filter((h) => isHospitalCluster(h.code)).map((hospital) => ({
    timestamp,
    cluster_id: hospital.code,
    projected_a_and_e_cat1_3: hospital.arrivals.total,
    bed_occupancy_ratio: hospital.bedOccupancy,
    triage_strain_index:
      hospital.edQueue.utilization * 100 + hospital.edQueue.waitHours * 12 + hospital.arrivals.category1 * 8,
  }));
}

export function diurnalClusterMetrics(
  snapshots: SystemHourSnapshot[],
  dayIso = "2022-07-19",
): HourlyClusterMetricDto[] {
  return snapshots.flatMap((snap) => clusterMetricsFromSnapshot(snap, dayIso));
}
