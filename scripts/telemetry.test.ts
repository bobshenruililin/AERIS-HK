import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CONCRETE_THERMAL_BATTERY_TAU_H } from "../lib/biophysics";
import { canyonAirTemp } from "../lib/epidemiology-engine";
import { FORMULAS } from "../lib/formulas";
import { DEFAULT_PHYSICS_FORCING } from "../lib/physics-forcing";
import { getBuildings } from "../lib/spatial-data";
import {
  assembleLiveFeed,
  compassToDeg,
  concreteTauH,
  DEFAULT_OPS_MODE,
  haversineKm,
  HKO_AWS_STATIONS,
  IDW_POWER,
  idwInterpolate,
  integrateIndoorLag,
  interpolateKowloonField,
  kmhToMs,
  LIVE_MONITORING_LABEL,
  mergeAwsStations,
  parseCsvDatetime,
  parseKeyedCsv,
  parseWindCsv,
  placeLorawanSensors,
  pollHkoStations,
  PREDICTIVE_TWIN_LABEL,
  sampleSensorMesh,
  SENSOR_COUNT,
  syntheticStationsFromAmbient,
} from "../lib/telemetry";
import { DEFAULT_POLICY } from "../lib/types";

const TEMP_CSV = `Date time,Automatic Weather Station,Air Temperature(degree Celsius)
202608301410,Sham Shui Po,33.1
202608301410,King's Park,32.4
202608301410,Kai Tak Runway Park,31.8
`;

const RH_CSV = `Date time,Automatic Weather Station,Relative Humidity(percent)
202608301410,King's Park,62
202608301410,Kai Tak Runway Park,68
`;

const WIND_CSV = `Date time,Automatic Weather Station,10-Minute Mean Wind Direction(Compass points),10-Minute Mean Speed(km/hour),10-Minute Maximum Gust(km/hour)
202608301410,King's Park,E,18.0,24.0
202608301410,Kai Tak,Calm,0,0
`;

const SOLAR_CSV = `Date time,Automatic Weather Station,Global Solar Radiation(watt/square meter),Direct Solar Radiation(watt/square meter),Diffuse Radiation(watt/square meter)
202608301410,King's Park,640,410,230
`;

const buildings = getBuildings();

describe("HKO AWS ingest + IDW", () => {
  it("pins Sham Shui Po, King's Park, and Kai Tak with WGS84 coordinates", () => {
    assert.deepEqual(
      HKO_AWS_STATIONS.map((s) => s.id),
      ["ssp", "kp", "kt"],
    );
    assert.equal(HKO_AWS_STATIONS[0].nameEn, "Sham Shui Po");
    assert.equal(HKO_AWS_STATIONS[1].nameEn, "King's Park");
    assert.ok(HKO_AWS_STATIONS[2].nameEn.includes("Kai Tak"));
    for (const s of HKO_AWS_STATIONS) {
      assert.ok(s.lon > 114.15 && s.lon < 114.23);
      assert.ok(s.lat > 22.3 && s.lat < 22.34);
    }
  });

  it("parses HKO 1-minute CSV and 10-minute wind including Calm", () => {
    const temp = parseKeyedCsv(TEMP_CSV, 2, { min: -5, max: 50 });
    const rh = parseKeyedCsv(RH_CSV, 2, { min: 0, max: 100 });
    const wind = parseWindCsv(WIND_CSV);
    const solar = parseKeyedCsv(SOLAR_CSV, 2, { min: 0, max: 1600 });
    assert.equal(temp.get("Sham Shui Po")?.value, 33.1);
    assert.equal(parseCsvDatetime("202608301410"), Date.UTC(2026, 7, 30, 6, 10, 0));
    assert.equal(compassToDeg("Calm"), null);
    assert.equal(compassToDeg("E"), 90);
    assert.equal(wind.get("Kai Tak")?.calm, true);
    assert.equal(wind.get("Kai Tak")?.speedMs, 0);
    assert.ok(Math.abs((wind.get("King's Park")?.speedMs ?? 0) - kmhToMs(18)) < 1e-12);
    const stations = mergeAwsStations({ temp, rh, wind, solar });
    const ssp = stations.find((s) => s.id === "ssp");
    const kp = stations.find((s) => s.id === "kp");
    assert.equal(ssp?.airTempC, 33.1);
    assert.equal(kp?.solarWm2, 640);
    assert.equal(ssp?.rhFrac, null);
    const feed = assembleLiveFeed({
      stations,
      sourcesOk: ["csv-temp", "csv-rh", "csv-wind", "csv-solar"],
      sourcesFailed: [],
      pulledAtMs: Date.UTC(2026, 7, 30, 6, 10, 0),
    });
    assert.equal(feed.stations.find((s) => s.id === "ssp")?.rhFrac, 0.65);
    assert.equal(feed.stations.find((s) => s.id === "ssp")?.solarWm2, 640);
    assert.equal(feed.field.power, IDW_POWER);
    assert.equal(feed.field.cells.length, 12 * 8);
  });

  it("returns the collocated station value and interpolates a midpoint", () => {
    const stations = mergeAwsStations({
      temp: parseKeyedCsv(TEMP_CSV, 2),
      rh: parseKeyedCsv(RH_CSV, 2),
      wind: parseWindCsv(WIND_CSV),
      solar: parseKeyedCsv(SOLAR_CSV, 2),
    });
    const ssp = stations.find((s) => s.id === "ssp")!;
    const kp = stations.find((s) => s.id === "kp")!;
    const atSsp = idwInterpolate(stations, ssp.lon, ssp.lat);
    assert.equal(atSsp.airTempC, ssp.airTempC);
    const two = [ssp, kp];
    const midLon = (ssp.lon + kp.lon) / 2;
    const midLat = (ssp.lat + kp.lat) / 2;
    const mid = idwInterpolate(two, midLon, midLat);
    assert.ok(mid.airTempC != null);
    const d1 = haversineKm(midLon, midLat, ssp.lon, ssp.lat);
    const d2 = haversineKm(midLon, midLat, kp.lon, kp.lat);
    const w1 = 1 / d1 ** 2;
    const w2 = 1 / d2 ** 2;
    const expected = (w1 * ssp.airTempC! + w2 * kp.airTempC!) / (w1 + w2);
    assert.ok(Math.abs(mid.airTempC! - expected) < 1e-9);
    const field = interpolateKowloonField(stations);
    assert.ok(field.cells.every((c) => c.airTempC != null));
  });
});

describe("synthetic LoRaWAN 劏房 mesh", () => {
  it("places exactly 250 Sham Shui Po sensors with τ = 4 h identity", () => {
    assert.equal(CONCRETE_THERMAL_BATTERY_TAU_H, 4);
    assert.equal(SENSOR_COUNT, 250);
    const hosts = placeLorawanSensors(buildings);
    assert.equal(hosts.length, 250);
    assert.ok(hosts.every((s) => s.id.startsWith("LRN-")));
    assert.equal(new Set(hosts.map((s) => s.id)).size, 250);
    const sspIds = new Set(
      buildings.filter((b) => b.properties.district === "Sham Shui Po").map((b) => b.properties.id),
    );
    assert.ok(hosts.every((s) => sspIds.has(s.buildingId)));
    assert.equal(concreteTauH(1), 4);
    assert.equal(concreteTauH(0), 2);
  });

  it("is bit-stable for a fixed station snapshot, hour, and policy", () => {
    const stations = syntheticStationsFromAmbient(33.2, 0.7, 0);
    const a = sampleSensorMesh({
      stations,
      buildings,
      policy: DEFAULT_POLICY,
      hour: 15,
      forcing: DEFAULT_PHYSICS_FORCING,
      pulledAtMs: 0,
    });
    const b = sampleSensorMesh({
      stations,
      buildings,
      policy: DEFAULT_POLICY,
      hour: 15,
      forcing: DEFAULT_PHYSICS_FORCING,
      pulledAtMs: 0,
    });
    assert.equal(a.count, 250);
    assert.deepEqual(
      a.sensors.map((s) => [s.id, s.lon, s.lat, s.indoorC, s.acOn]),
      b.sensors.map((s) => [s.id, s.lon, s.lat, s.indoorC, s.acOn]),
    );
  });

  it("cools AC-on kinetics toward 27.4°C relative to AC-off fabric lag", () => {
    const on = integrateIndoorLag({
      ambientC: 34,
      tauH: 4,
      acOn: true,
      hour: 15,
      rho: 0.85,
    });
    const off = integrateIndoorLag({
      ambientC: 34,
      tauH: 4,
      acOn: false,
      hour: 15,
      rho: 0.85,
    });
    assert.ok(on < off);
    assert.ok(on < 32);
    assert.ok(Math.abs(off - 34) < 0.05);
  });
});

describe("LIVE vs PREDICTIVE HUD + SSR", () => {
  it("defaults ops mode to a compile-time LIVE literal", () => {
    assert.equal(DEFAULT_OPS_MODE, "live");
    assert.equal(LIVE_MONITORING_LABEL, "LIVE MONITORING");
    assert.equal(PREDICTIVE_TWIN_LABEL, "PREDICTIVE TWIN");
  });

  it("quotes IDW and LoRaWAN lag identities used by the engine", () => {
    assert.match(FORMULAS.idw.identity, /d_i\^{-p}/);
    assert.match(FORMULAS.idw.note, /Fiala/);
    assert.match(FORMULAS["lorawan-lag"].identity, /τ=4h/);
    assert.match(FORMULAS["lorawan-lag"].note, /250/);
  });

  it("keeps telemetry libraries free of window / document / localStorage", () => {
    for (const file of [
      "lib/telemetry/hko-feed.ts",
      "lib/telemetry/sensor-network.ts",
      "lib/telemetry/ops-mode.ts",
    ]) {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      assert.equal(src.includes("window"), false, file);
      assert.equal(src.includes("document"), false, file);
      assert.equal(src.includes("localStorage"), false, file);
      assert.equal(src.includes("Date.now()"), file.includes("hko-feed.ts"), file);
    }
  });

  it("hydrates MissionControl behind ClientOnly + MissionShell", () => {
    const clientOnly = readFileSync(new URL("../components/system/ClientOnly.tsx", import.meta.url), "utf8");
    const shell = readFileSync(new URL("../components/system/MissionShell.tsx", import.meta.url), "utf8");
    const mission = readFileSync(new URL("../components/simulation/MissionControl.tsx", import.meta.url), "utf8");
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    const toggle = readFileSync(new URL("../components/ui/LiveOpsToggle.tsx", import.meta.url), "utf8");
    const route = readFileSync(new URL("../app/api/telemetry/live/route.ts", import.meta.url), "utf8");
    assert.match(clientOnly, /useState\(false\)/);
    assert.match(shell, /data-hydrating="1"/);
    assert.match(mission, /ClientOnly/);
    assert.match(mission, /LiveOpsToggle/);
    assert.match(layout, /suppressHydrationWarning/);
    assert.match(toggle, /data-testid="live-ops-toggle"/);
    assert.match(toggle, /data-testid="ops-mode-live"/);
    assert.match(toggle, /data-testid="ops-mode-predictive"/);
    assert.match(toggle, /data-testid="lorawan-mesh-count"/);
    assert.match(route, /runtime = "edge"/);
    assert.equal(route.includes("node:fs"), false);
    assert.equal(route.includes("lib/hko/ingest"), false);
  });
});

describe("spatial IDW residual in canyon air temperature", () => {
  it("lifts a Sham Shui Po footprint when the local AWS is hotter than the Kowloon mean", () => {
    const b = buildings.find((row) => row.properties.district === "Sham Shui Po")!;
    const envelope = {
      generatedAt: "2026-08-30T00:00:00.000Z",
      timezone: "Asia/Hong_Kong" as const,
      source: "hko-open-data" as const,
      degraded: false,
      degradeReason: null,
      nowHour: 15,
      kowloonAirTempC: 32,
      kowloonRhFrac: 0.7,
      stations: [],
      warning: {
        veryHotWeatherWarning: false,
        actionCode: null,
        code: null,
        nameEn: "",
        nameZh: "",
        issueTime: null,
        updateTime: null,
      },
      forecast: null,
      hours: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        airTempC: 32,
        rhFrac: 0.7,
        origin: "observed" as const,
      })),
      observedHours: 24,
      forecastHours: 0,
      blendedHours: 0,
    };
    const base = canyonAirTemp(15, b, DEFAULT_POLICY, envelope, DEFAULT_PHYSICS_FORCING, null);
    const hot = canyonAirTemp(15, b, DEFAULT_POLICY, envelope, DEFAULT_PHYSICS_FORCING, {
      airTempC: 34.5,
      rhFrac: 0.62,
      windDirDeg: 90,
      windSpeedMs: 2,
      solarWm2: 700,
      weightSum: 1,
    });
    assert.ok(hot > base + 1.5);
  });
});

describe("live HKO Open Data poller", () => {
  it("pulls Sham Shui Po / King's Park / Kai Tak from the public CSV APIs", async () => {
    const feed = await pollHkoStations();
    assert.equal(feed.stations.length, 3);
    const names = feed.stations.map((s) => s.nameEn);
    assert.ok(names.includes("Sham Shui Po"));
    assert.ok(names.includes("King's Park"));
    assert.ok(names.some((n) => n.includes("Kai Tak")));
    const temps = feed.stations.map((s) => s.airTempC).filter((v): v is number => v != null);
    assert.ok(temps.length >= 2);
    assert.ok(temps.every((t) => t > 10 && t < 45));
    assert.ok(feed.field.cells.length >= 64);
    assert.ok(feed.sourcesOk.length >= 1);
  });
});
