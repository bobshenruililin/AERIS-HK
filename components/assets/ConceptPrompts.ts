export interface ConceptPrompt {
  id: string;
  tool: "Midjourney v6" | "FLUX.1" | "Imagine";
  title: string;
  prompt: string;
  negative?: string;
}

export const AERIS_CONCEPT_PROMPTS: ConceptPrompt[] = [
  {
    id: "hero-twin",
    tool: "Midjourney v6",
    title: "Kowloon thermal twin hero still",
    prompt:
      "Ultra-wide cinematic aerial of Sham Shui Po tong lau canyons at blue hour, Pei Ho Street and Apliu Street, holographic cyan wireframe 3D buildings extruded from a dark digital twin, crimson heat plumes pooling in subdivided flats, amber cardiovascular risk glow, MapLibre dark-matter basemap aesthetic, aerospace HUD overlays, photoreal Hong Kong neon + volumetric mist --ar 21:9 --stylize 180 --v 6",
    negative: "cartoon, daylight tourist postcard, empty streets, watermark",
  },
  {
    id: "canyon-particles",
    tool: "FLUX.1",
    title: "Sea-breeze vs canyon stagnation",
    prompt:
      "Temple Street Yau Ma Tei night market canyon, looking north, luminous particle traces of harbour sea breeze stalling between 6-storey tong lau, thermal inertia colour grade emerald to crimson, scientific visualization quality, 8k, cinematic fog, no people faces",
  },
  {
    id: "ha-surge",
    tool: "Midjourney v6",
    title: "Hospital Authority surge board",
    prompt:
      "Mission-control glassmorphism dashboard floating over Queen Elizabeth Hospital and Kwong Wah Hospital at night, bilingual Chinese English telemetry, A&E Category 1-3 sparkline, dark navy, cyan type, photoreal architecture, --ar 16:9 --v 6",
  },
  {
    id: "indoor-inertia",
    tool: "Imagine",
    title: "Subdivided flat night heat",
    prompt:
      "Interior of a Hong Kong subdivided flat (劏房) at 01:00, window AC dripping, infrared overlay showing 33C indoor air, elderly occupant silhouette, respectful documentary lighting, no sensationalism, thermal color grade",
  },
  {
    id: "satellite-schema",
    tool: "FLUX.1",
    title: "Satellite thermal texture schema",
    prompt:
      "Nadir satellite thermal mosaic of Kowloon West, 10m pixels, night-time LST, Sham Shui Po hotter than Victoria Harbour, legend in Kelvin, cartographic, scientific, not artistic bokeh",
  },
];

export const HUD_SVG_MARK = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 48" fill="none">
  <rect x="0.5" y="0.5" width="319" height="47" rx="8" stroke="#22d3ee" stroke-opacity="0.35"/>
  <circle cx="18" cy="24" r="5" fill="#22d3ee"/>
  <text x="32" y="20" fill="#ecfeff" font-size="11" font-family="ui-monospace,monospace">AERIS-HK LOCK</text>
  <text x="32" y="34" fill="#67e8f9" font-size="9" font-family="ui-monospace,monospace">EPSG:4326 DISPLAY · EPSG:2326 STORE</text>
  <path d="M250 24 H310" stroke="#22d3ee" stroke-opacity="0.6"/>
  <path d="M304 18 L310 24 L304 30" stroke="#22d3ee"/>
</svg>
`;
