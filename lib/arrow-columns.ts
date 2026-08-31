/**
 * Zero-copy Apache Arrow / typed-array hour table.
 * Rows are packed hour-major so a diurnal scrub is a subarray walk, not a
 * DuckDB round-trip or an object-per-row scan. Target: < 5 ms for 10k+ rows.
 */
import type { BuildingFeature, BuildingHourState, CriticalBuildingRow, DistrictHourAggregate, DistrictName } from "./types";
import { classifyCvi } from "./epidemiology-engine";
import { CVI_MODERATE_MAX } from "./constants";
import { tableFromArrays, tableToIPC } from "apache-arrow";

export const DISTRICT_CODE = { "Sham Shui Po": 0, "Yau Tsim Mong": 1 } as const;
export const DISTRICT_NAME: DistrictName[] = ["Sham Shui Po", "Yau Tsim Mong"];

export interface HourColumnStore {
  n: number;
  buildingId: string[];
  nameEn: string[];
  nameZh: string[];
  district: Uint8Array;
  hour: Uint8Array;
  cvi: Float32Array;
  microWbgt: Float32Array;
  indoorTa: Float32Array;
  /** length 25; hour h occupies [hourStart[h], hourStart[h+1]). */
  hourStart: Uint32Array;
}

export interface HourColumnView {
  start: number;
  count: number;
  cvi: Float32Array;
  microWbgt: Float32Array;
  indoorTa: Float32Array;
  district: Uint8Array;
  hour: Uint8Array;
}

export interface ColumnQueryResult {
  elapsedMs: number;
  districtHourly: DistrictHourAggregate[];
  topCritical: CriticalBuildingRow[];
  rowCount: number;
}

export function packHourColumns(buildings: BuildingFeature[], hourly: BuildingHourState[]): HourColumnStore {
  const meta = new Map(buildings.map((b) => [b.properties.id, b.properties]));
  const n = hourly.length;
  const counts = new Uint32Array(24);
  for (let i = 0; i < n; i += 1) {
    counts[Math.round(hourly[i].hour) % 24] += 1;
  }
  const hourStart = new Uint32Array(25);
  for (let h = 0; h < 24; h += 1) {
    hourStart[h + 1] = hourStart[h] + counts[h];
  }
  const cursor = hourStart.slice(0, 24);
  const buildingId = new Array<string>(n);
  const nameEn = new Array<string>(n);
  const nameZh = new Array<string>(n);
  const district = new Uint8Array(n);
  const hour = new Uint8Array(n);
  const cvi = new Float32Array(n);
  const microWbgt = new Float32Array(n);
  const indoorTa = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const row = hourly[i];
    const props = meta.get(row.buildingId);
    const h = Math.round(row.hour) % 24;
    const slot = cursor[h]++;
    buildingId[slot] = row.buildingId;
    nameEn[slot] = props?.nameEn ?? row.buildingId;
    nameZh[slot] = props?.nameZh ?? "";
    district[slot] = props?.district === "Yau Tsim Mong" ? 1 : 0;
    hour[slot] = h;
    cvi[slot] = row.cvi;
    microWbgt[slot] = row.microWbgt;
    indoorTa[slot] = row.indoorTa;
  }
  return { n, buildingId, nameEn, nameZh, district, hour, cvi, microWbgt, indoorTa, hourStart };
}

/** Zero-copy typed-array window for one hour. Callers must not mutate the views. */
export function hourColumnView(store: HourColumnStore, hour: number): HourColumnView {
  const h = Math.round(hour) % 24;
  const start = store.hourStart[h] ?? 0;
  const end = store.hourStart[h + 1] ?? start;
  return {
    start,
    count: end - start,
    cvi: store.cvi.subarray(start, end),
    microWbgt: store.microWbgt.subarray(start, end),
    indoorTa: store.indoorTa.subarray(start, end),
    district: store.district.subarray(start, end),
    hour: store.hour.subarray(start, end),
  };
}

export function encodeHourColumnsIpc(store: HourColumnStore): Uint8Array {
  const table = tableFromArrays({
    building_id: store.buildingId,
    name_en: store.nameEn,
    name_zh: store.nameZh,
    district: Array.from(store.district, (code) => DISTRICT_NAME[code] ?? "Sham Shui Po"),
    hour: store.hour,
    cvi: store.cvi,
    micro_wbgt: store.microWbgt,
    indoor_ta: store.indoorTa,
  });
  return tableToIPC(table, "file");
}

export function queryHourColumns(
  store: HourColumnStore,
  hour: number,
  minCvi = CVI_MODERATE_MAX,
): ColumnQueryResult {
  const started = performance.now();
  const view = hourColumnView(store, hour);
  const h = Math.round(hour) % 24;
  const distSum = [
    { cvi: 0, wbgt: 0, ta: 0, n: 0 },
    { cvi: 0, wbgt: 0, ta: 0, n: 0 },
  ];
  const top: Array<{ i: number; cvi: number }> = [];
  const { start, count } = view;
  for (let j = 0; j < count; j += 1) {
    const i = start + j;
    const d = store.district[i];
    distSum[d].cvi += store.cvi[i];
    distSum[d].wbgt += store.microWbgt[i];
    distSum[d].ta += store.indoorTa[i];
    distSum[d].n += 1;
    if (store.cvi[i] >= minCvi) top.push({ i, cvi: store.cvi[i] });
  }
  top.sort((a, b) => b.cvi - a.cvi);
  const districtHourly: DistrictHourAggregate[] = [];
  for (let d = 0; d < 2; d += 1) {
    const b = distSum[d];
    if (b.n === 0) continue;
    districtHourly.push({
      district: DISTRICT_NAME[d],
      hour: h,
      meanCvi: b.cvi / b.n,
      meanWbgt: b.wbgt / b.n,
      meanIndoorTa: b.ta / b.n,
      buildingCount: b.n,
    });
  }
  const topCritical: CriticalBuildingRow[] = top.slice(0, 10).map((row) => {
    const i = row.i;
    return {
      buildingId: store.buildingId[i],
      nameEn: store.nameEn[i],
      nameZh: store.nameZh[i],
      district: DISTRICT_NAME[store.district[i]],
      hour: h,
      cvi: store.cvi[i],
      microWbgt: store.microWbgt[i],
      indoorTa: store.indoorTa[i],
      cviTier: classifyCvi(store.cvi[i]),
    };
  });
  return {
    elapsedMs: performance.now() - started,
    districtHourly,
    topCritical,
    rowCount: store.n,
  };
}

/** Full 24-hour GROUP BY without allocating row objects in the hot loop. */
export function groupDistrictHourlyColumns(store: HourColumnStore): DistrictHourAggregate[] {
  const acc = new Float64Array(2 * 24 * 4);
  const counts = new Uint32Array(2 * 24);
  for (let i = 0; i < store.n; i += 1) {
    const slot = store.district[i] * 24 + store.hour[i];
    const base = slot * 4;
    acc[base] += store.cvi[i];
    acc[base + 1] += store.microWbgt[i];
    acc[base + 2] += store.indoorTa[i];
    counts[slot] += 1;
  }
  const out: DistrictHourAggregate[] = [];
  for (let d = 0; d < 2; d += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const slot = d * 24 + hour;
      const n = counts[slot];
      if (!n) continue;
      const base = slot * 4;
      out.push({
        district: DISTRICT_NAME[d],
        hour,
        meanCvi: acc[base] / n,
        meanWbgt: acc[base + 1] / n,
        meanIndoorTa: acc[base + 2] / n,
        buildingCount: n,
      });
    }
  }
  return out;
}
