import type { RGBA } from "./types";

export const AERIS_TITLE_EN = "AERIS-HK";
export const AERIS_TITLE_ZH = "氣候與流行病空間推演系統";
export const AERIS_FULL_TITLE = `${AERIS_TITLE_EN} | ${AERIS_TITLE_ZH}`;

export const KOWLOON_VIEW = {
  longitude: 114.1628,
  latitude: 22.3307,
  zoom: 16.2,
  pitch: 58,
  bearing: -22,
  maxPitch: 75,
  minZoom: 12.5,
  maxZoom: 19.5,
} as const;

export const CARTO_DARK_MATTER_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export const EXTRUSION_SCALE = 2.8;

export const CVI_COLOR_LOW: RGBA = [16, 185, 129, 210];
export const CVI_COLOR_MODERATE: RGBA = [245, 158, 11, 225];
export const CVI_COLOR_HIGH: RGBA = [239, 68, 68, 245];
export const CVI_HOVER_LINE: RGBA = [34, 211, 238, 255];
export const CVI_IDLE_LINE: RGBA = [15, 23, 42, 90];

export const CVI_LOW_MAX = 40;
export const CVI_MODERATE_MAX = 70;
export const CVI_HIGH_MAX = 85;

export const INDOOR_HAZARD_C = 32;
export const NIGHT_INERTIA_START = 21;
export const NIGHT_INERTIA_END = 3;

export const CATCHMENT_POPULATION = 412_000;

export const HEAT_EPISODE_LABEL = "HKO Open Data rolling 24-hour observed + forecast envelope (Kowloon West)";
