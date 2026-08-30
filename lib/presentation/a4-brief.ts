/**
 * Publication-grade A4 executive briefing (PDF + PNG).
 * Vector text / rules / violin / HA bars; raster inset of the live twin canvas.
 * Helvetica only (no CJK in the PDF text layer). Chinese lives on the map PNG.
 */
import type { MonteCarloResult } from "../monte-carlo";
import type { HospitalHourState } from "../types";

export const A4_PT = { w: 595.28, h: 841.89 } as const;
export const A4_PNG_PX = { w: 1240, h: 1754 } as const;

export interface A4BriefingModel {
  title: string;
  beatTitle: string;
  hourLabel: string;
  scenarioName: string;
  generatedAt: string;
  kowloonAirTempC: number;
  regionalWbgt: number;
  cviMean: number;
  admissionsAverted: number;
  mapJpeg: Uint8Array | null;
  mapJpegWidth: number;
  mapJpegHeight: number;
  monteCarlo: {
    admissionsP025: number;
    admissionsP50: number;
    admissionsP975: number;
    bedsP025: number;
    bedsP50: number;
    bedsP975: number;
    violin: number[];
    iterations: number;
    engine: string;
  } | null;
  hospitals: Array<{
    code: string;
    nameEn: string;
    occupancy: number;
    occupancyPre: number;
    deficitPct: number;
    arrivals: number;
    waitCat3: number | null;
  }>;
}

export function modelFromTwin(args: {
  beatTitle: string;
  hourLabel: string;
  scenarioName: string;
  generatedAt: string;
  kowloonAirTempC: number;
  regionalWbgt: number;
  cviMean: number;
  admissionsAverted: number;
  mapJpeg: Uint8Array | null;
  monteCarlo: MonteCarloResult | null;
  hospitals: HospitalHourState[];
}): A4BriefingModel {
  return {
    title: "AERIS-HK Executive Heat-Health Briefing",
    beatTitle: args.beatTitle,
    hourLabel: args.hourLabel,
    scenarioName: args.scenarioName,
    generatedAt: args.generatedAt,
    kowloonAirTempC: args.kowloonAirTempC,
    regionalWbgt: args.regionalWbgt,
    cviMean: args.cviMean,
    admissionsAverted: args.admissionsAverted,
    mapJpeg: args.mapJpeg,
    mapJpegWidth: args.mapJpeg ? jpegDimensions(args.mapJpeg)?.width ?? 1200 : 0,
    mapJpegHeight: args.mapJpeg ? jpegDimensions(args.mapJpeg)?.height ?? 675 : 0,
    monteCarlo: args.monteCarlo
      ? {
          admissionsP025: args.monteCarlo.admissions.p025,
          admissionsP50: args.monteCarlo.admissions.p50,
          admissionsP975: args.monteCarlo.admissions.p975,
          bedsP025: args.monteCarlo.bedDeficitPct.p025,
          bedsP50: args.monteCarlo.bedDeficitPct.p50,
          bedsP975: args.monteCarlo.bedDeficitPct.p975,
          violin: args.monteCarlo.violinAdmissions,
          iterations: args.monteCarlo.iterations,
          engine: args.monteCarlo.engine,
        }
      : null,
    hospitals: args.hospitals.map((h) => ({
      code: h.code,
      nameEn: h.nameEn,
      occupancy: h.occupancyPostTransfer,
      occupancyPre: h.occupancyPreTransfer,
      deficitPct: h.bedDeficitPct,
      arrivals: h.arrivals.total,
      waitCat3: h.waitCat3P50Minutes,
    })),
  };
}

function pdfEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function concatBytes(parts: Array<string | Uint8Array>): Uint8Array {
  const encoded = parts.map((p) => (typeof p === "string" ? new TextEncoder().encode(p) : p));
  const total = encoded.reduce((s, b) => s + b.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of encoded) {
    out.set(b, o);
    o += b.byteLength;
  }
  return out;
}

export function buildA4Pdf(model: A4BriefingModel): Uint8Array {
  const pageW = A4_PT.w;
  const pageH = A4_PT.h;
  const ops: string[] = [];
  const ink = (rgb: string) => {
    ops.push(`${rgb} rg`);
  };
  const text = (x: number, y: number, size: number, s: string) => {
    ops.push(`BT /F1 ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfEscape(s)}) Tj ET`);
  };
  const fill = (x: number, y: number, w: number, h: number, rgb: string) => {
    ops.push(`${rgb} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  };
  const paper = "0.96 0.97 0.98";
  const mute = "0.45 0.52 0.58";
  const gold = "0.83 0.69 0.22";
  const strokeRect = (x: number, y: number, w: number, h: number) => {
    ops.push(`0.15 0.23 0.37 RG 0.6 w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  };

  fill(0, 0, pageW, pageH, "0.98 0.98 0.97");
  fill(0, pageH - 54, pageW, 54, "0.04 0.09 0.16");
  ink(paper);
  text(36, pageH - 28, 14, model.title);
  ink(gold);
  text(36, pageH - 44, 9, `${model.beatTitle}  ·  ${model.hourLabel} HKT  ·  ${model.scenarioName}`);

  fill(36, pageH - 92, 120, 28, "0.06 0.18 0.22");
  ink(paper);
  text(42, pageH - 74, 8, "Kowloon Ta");
  text(42, pageH - 86, 11, `${model.kowloonAirTempC.toFixed(1)} C`);
  fill(162, pageH - 92, 120, 28, "0.22 0.12 0.05");
  ink(paper);
  text(168, pageH - 74, 8, "WBGT (UTCI analogue)");
  text(168, pageH - 86, 11, `${model.regionalWbgt.toFixed(1)} C`);
  fill(288, pageH - 92, 120, 28, "0.18 0.07 0.09");
  ink(paper);
  text(294, pageH - 74, 8, "Mean CVI");
  text(294, pageH - 86, 11, model.cviMean.toFixed(1));
  fill(414, pageH - 92, 145, 28, "0.05 0.16 0.12");
  ink(paper);
  text(420, pageH - 74, 8, "Cat 1-3 averted / 24h");
  text(420, pageH - 86, 11, model.admissionsAverted.toFixed(1));

  const mapY = 430;
  const mapH = 310;
  fill(36, mapY, pageW - 72, mapH, "0.03 0.05 0.08");
  strokeRect(36, mapY, pageW - 72, mapH);
  if (model.mapJpeg) {
    ops.push(`q ${pageW - 76} 0 0 ${mapH - 4} 38 ${mapY + 2} cm /Im1 Do Q`);
  } else {
    ink(mute);
    text(48, mapY + mapH / 2, 10, "Twin canvas snapshot unavailable");
  }
  ink(mute);
  text(36, mapY - 14, 8, "Active map view  ·  software ENU twin (WGS84 display)");

  ink("0.07 0.09 0.12");
  text(36, 400, 11, "Monte Carlo 95% CI  (1,000 draws, Bishai RR 0.22 / C)");
  if (model.monteCarlo) {
    const mc = model.monteCarlo;
    text(
      36,
      384,
      9,
      `CVD presentations  p2.5 ${mc.admissionsP025.toFixed(1)}   p50 ${mc.admissionsP50.toFixed(1)}   p97.5 ${mc.admissionsP975.toFixed(1)}   (${mc.iterations} · ${mc.engine})`,
    );
    text(
      36,
      370,
      9,
      `HA bed deficit %    p2.5 ${mc.bedsP025.toFixed(2)}   p50 ${mc.bedsP50.toFixed(2)}   p97.5 ${mc.bedsP975.toFixed(2)}`,
    );
    const vx0 = 36;
    const vy0 = 318;
    const vw = pageW - 72;
    const vh = 44;
    strokeRect(vx0, vy0, vw, vh);
    const n = Math.max(1, mc.violin.length);
    const peak = Math.max(1e-6, ...mc.violin);
    const pts: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const x = vx0 + (i / Math.max(1, n - 1)) * vw;
      const y = vy0 + vh / 2 + (mc.violin[i] / peak) * (vh / 2 - 3);
      pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    for (let i = n - 1; i >= 0; i -= 1) {
      const x = vx0 + (i / Math.max(1, n - 1)) * vw;
      const y = vy0 + vh / 2 - (mc.violin[i] / peak) * (vh / 2 - 3);
      pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    ops.push(`0.45 0.38 0.82 rg ${pts[0]} m ${pts.slice(1).map((p) => `${p} l`).join(" ")} f`);
  } else {
    text(36, 384, 9, "Monte Carlo idle — run the policy-drawer sampler or export after cache settles.");
  }

  ink("0.07 0.09 0.12");
  text(36, 298, 11, "Hospital Authority risk breakdown  (CMC / KWH / PMH / QEH)");
  fill(36, 274, pageW - 72, 16, "0.06 0.09 0.14");
  ink(paper);
  text(40, 279, 8, "Code");
  text(88, 279, 8, "Hospital");
  text(280, 279, 8, "Occ. pre");
  text(340, 279, 8, "Occ. post");
  text(410, 279, 8, "Deficit");
  text(470, 279, 8, "Arrivals");
  text(530, 279, 8, "C3 p50");
  model.hospitals.forEach((h, i) => {
    const y = 258 - i * 18;
    if (i % 2 === 0) fill(36, y - 4, pageW - 72, 18, "0.93 0.94 0.95");
    ink("0.07 0.09 0.12");
    text(40, y, 8, h.code);
    text(88, y, 8, h.nameEn.slice(0, 28));
    text(280, y, 8, `${(h.occupancyPre * 100).toFixed(0)}%`);
    text(340, y, 8, `${(h.occupancy * 100).toFixed(0)}%`);
    text(410, y, 8, `${h.deficitPct.toFixed(1)}%`);
    text(470, y, 8, h.arrivals.toFixed(1));
    text(530, y, 8, h.waitCat3 != null ? `${h.waitCat3.toFixed(0)}m` : "—");
  });

  ink(mute);
  text(36, 48, 7, `Generated ${model.generatedAt}  ·  Research estimator — not an official HKO / HA / HKSAR product.`);
  text(36, 36, 7, "Sol-Air Eq. 3  q_abs = I_peak sin^1.15(gamma) (1-rho)  ·  UTCI analogue is ISO 7243 WBGT, not Fiala.");

  const content = ops.join("\n");
  const objects: Array<string | Uint8Array> = [];
  const addObj = (body: string | Uint8Array) => {
    objects.push(body);
    return objects.length;
  };

  addObj("<< /Type /Catalog /Pages 2 0 R >>\n");
  addObj("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n");

  const resources = model.mapJpeg
    ? "<< /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> /ProcSet [/PDF /Text /ImageC] >>"
    : "<< /Font << /F1 5 0 R >> /ProcSet [/PDF /Text] >>";
  addObj(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources ${resources} >>\n`,
  );
  addObj(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\n`);
  addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\n");
  if (model.mapJpeg) {
    const dim = jpegDimensions(model.mapJpeg) ?? {
      width: model.mapJpegWidth || 1200,
      height: model.mapJpegHeight || 675,
    };
    addObj(
      concatBytes([
        `<< /Type /XObject /Subtype /Image /Width ${dim.width} /Height ${dim.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${model.mapJpeg.byteLength} >>\nstream\n`,
        model.mapJpeg,
        "\nendstream\n",
      ]),
    );
  }

  const chunks: Uint8Array[] = [new TextEncoder().encode("%PDF-1.4\n")];
  const offsets = [0];
  let pos = chunks[0].byteLength;
  objects.forEach((obj, i) => {
    offsets.push(pos);
    const header = new TextEncoder().encode(`${i + 1} 0 obj\n`);
    const body = typeof obj === "string" ? new TextEncoder().encode(obj) : obj;
    const end = new TextEncoder().encode("endobj\n");
    chunks.push(header, body, end);
    pos += header.byteLength + body.byteLength + end.byteLength;
  });
  const xrefStart = pos;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(new TextEncoder().encode(xref));
  return concatBytes(chunks);
}

export function jpegFromDataUrl(dataUrl: string): Uint8Array | null {
  const match = dataUrl.match(/^data:image\/jpeg;base64,(.+)$/);
  if (!match) return null;
  const bin = atob(match[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** SOF0 / SOF2 dimensions from a JPEG bitstream. */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 0;
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      if (width > 0 && height > 0) return { width, height };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    i += 2 + Math.max(0, len);
  }
  return null;
}

export function downloadBytes(bytes: Uint8Array, mime: string, filename: string): void {
  if (typeof document === "undefined") return;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Raster A4 sheet (1240×1754) for PNG export. Map inset is optional. */
export function paintA4Png(
  ctx: CanvasRenderingContext2D,
  model: A4BriefingModel,
  mapImage: CanvasImageSource | null,
): void {
  const W = A4_PNG_PX.w;
  const H = A4_PNG_PX.h;
  const sx = W / A4_PT.w;
  const sy = H / A4_PT.h;
  const x = (pt: number) => pt * sx;
  const yFromTop = (ptFromBottom: number) => H - ptFromBottom * sy;
  ctx.fillStyle = "#fafaf8";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#0a1729";
  ctx.fillRect(0, 0, W, 54 * sy);
  ctx.fillStyle = "#f5f7f8";
  ctx.font = `600 ${14 * sx}px Helvetica, Arial, sans-serif`;
  ctx.fillText(model.title, x(36), yFromTop(A4_PT.h - 28));
  ctx.fillStyle = "#d4b038";
  ctx.font = `${9 * sx}px Helvetica, Arial, sans-serif`;
  ctx.fillText(`${model.beatTitle}  ·  ${model.hourLabel} HKT  ·  ${model.scenarioName}`, x(36), yFromTop(A4_PT.h - 44));

  const cards: Array<{ x: number; bg: string; k: string; v: string }> = [
    { x: 36, bg: "#0f2e38", k: "Kowloon Ta", v: `${model.kowloonAirTempC.toFixed(1)} C` },
    { x: 162, bg: "#381e0d", k: "WBGT (UTCI analogue)", v: `${model.regionalWbgt.toFixed(1)} C` },
    { x: 288, bg: "#2e1217", k: "Mean CVI", v: model.cviMean.toFixed(1) },
    { x: 414, bg: "#0d2920", k: "Cat 1-3 averted / 24h", v: model.admissionsAverted.toFixed(1) },
  ];
  for (const c of cards) {
    ctx.fillStyle = c.bg;
    ctx.fillRect(x(c.x), yFromTop(A4_PT.h - 64) - 28 * sy, (c.x === 414 ? 145 : 120) * sx, 28 * sy);
    ctx.fillStyle = "#f3f6f8";
    ctx.font = `${8 * sx}px Helvetica, Arial, sans-serif`;
    ctx.fillText(c.k, x(c.x + 6), yFromTop(A4_PT.h - 74));
    ctx.font = `${11 * sx}px Helvetica, Arial, sans-serif`;
    ctx.fillText(c.v, x(c.x + 6), yFromTop(A4_PT.h - 86));
  }

  const mapY = 430;
  const mapH = 310;
  ctx.fillStyle = "#080d14";
  ctx.fillRect(x(36), yFromTop(mapY + mapH), (A4_PT.w - 72) * sx, mapH * sy);
  if (mapImage) {
    ctx.drawImage(mapImage, x(38), yFromTop(mapY + mapH - 2), (A4_PT.w - 76) * sx, (mapH - 4) * sy);
  }
  ctx.strokeStyle = "#26395e";
  ctx.lineWidth = 1;
  ctx.strokeRect(x(36), yFromTop(mapY + mapH), (A4_PT.w - 72) * sx, mapH * sy);

  ctx.fillStyle = "#12171f";
  ctx.font = `600 ${11 * sx}px Helvetica, Arial, sans-serif`;
  ctx.fillText("Monte Carlo 95% CI  (1,000 draws, Bishai RR 0.22 / C)", x(36), yFromTop(400));
  ctx.font = `${9 * sx}px Helvetica, Arial, sans-serif`;
  if (model.monteCarlo) {
    const mc = model.monteCarlo;
    ctx.fillText(
      `CVD presentations  p2.5 ${mc.admissionsP025.toFixed(1)}   p50 ${mc.admissionsP50.toFixed(1)}   p97.5 ${mc.admissionsP975.toFixed(1)}   (${mc.iterations} · ${mc.engine})`,
      x(36),
      yFromTop(384),
    );
    ctx.fillText(
      `HA bed deficit %    p2.5 ${mc.bedsP025.toFixed(2)}   p50 ${mc.bedsP50.toFixed(2)}   p97.5 ${mc.bedsP975.toFixed(2)}`,
      x(36),
      yFromTop(370),
    );
    const vx0 = x(36);
    const vy0 = yFromTop(318 + 44);
    const vw = (A4_PT.w - 72) * sx;
    const vh = 44 * sy;
    ctx.strokeRect(vx0, vy0, vw, vh);
    const n = Math.max(1, mc.violin.length);
    const peak = Math.max(1e-6, ...mc.violin);
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) {
      const px = vx0 + (i / Math.max(1, n - 1)) * vw;
      const py = vy0 + vh / 2 - (mc.violin[i]! / peak) * (vh / 2 - 3);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    for (let i = n - 1; i >= 0; i -= 1) {
      const px = vx0 + (i / Math.max(1, n - 1)) * vw;
      const py = vy0 + vh / 2 + (mc.violin[i]! / peak) * (vh / 2 - 3);
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = "#7361d1";
    ctx.fill();
  } else {
    ctx.fillText("Monte Carlo idle — run the policy-drawer sampler or export after cache settles.", x(36), yFromTop(384));
  }

  ctx.fillStyle = "#12171f";
  ctx.font = `600 ${11 * sx}px Helvetica, Arial, sans-serif`;
  ctx.fillText("Hospital Authority risk breakdown  (CMC / KWH / PMH / QEH)", x(36), yFromTop(298));
  ctx.fillStyle = "#0f1724";
  ctx.fillRect(x(36), yFromTop(274 + 16), (A4_PT.w - 72) * sx, 16 * sy);
  ctx.fillStyle = "#f3f6f8";
  ctx.font = `${8 * sx}px Helvetica, Arial, sans-serif`;
  const heads = [
    [40, "Code"],
    [88, "Hospital"],
    [280, "Occ. pre"],
    [340, "Occ. post"],
    [410, "Deficit"],
    [470, "Arrivals"],
    [530, "C3 p50"],
  ] as const;
  for (const [px, label] of heads) ctx.fillText(label, x(px), yFromTop(279));
  model.hospitals.forEach((h, i) => {
    const rowY = 258 - i * 18;
    if (i % 2 === 0) {
      ctx.fillStyle = "#edeff2";
      ctx.fillRect(x(36), yFromTop(rowY + 14), (A4_PT.w - 72) * sx, 18 * sy);
    }
    ctx.fillStyle = "#12171f";
    ctx.fillText(h.code, x(40), yFromTop(rowY));
    ctx.fillText(h.nameEn.slice(0, 28), x(88), yFromTop(rowY));
    ctx.fillText(`${(h.occupancyPre * 100).toFixed(0)}%`, x(280), yFromTop(rowY));
    ctx.fillText(`${(h.occupancy * 100).toFixed(0)}%`, x(340), yFromTop(rowY));
    ctx.fillText(`${h.deficitPct.toFixed(1)}%`, x(410), yFromTop(rowY));
    ctx.fillText(h.arrivals.toFixed(1), x(470), yFromTop(rowY));
    ctx.fillText(h.waitCat3 != null ? `${h.waitCat3.toFixed(0)}m` : "—", x(530), yFromTop(rowY));
  });
  ctx.fillStyle = "#73848f";
  ctx.font = `${7 * sx}px Helvetica, Arial, sans-serif`;
  ctx.fillText(
    `Generated ${model.generatedAt}  ·  Research estimator — not an official HKO / HA / HKSAR product.`,
    x(36),
    yFromTop(48),
  );
  ctx.fillText(
    "Sol-Air Eq. 3  q_abs = I_peak sin^1.15(gamma) (1-rho)  ·  UTCI analogue is ISO 7243 WBGT, not Fiala.",
    x(36),
    yFromTop(36),
  );
}

export async function buildA4Png(model: A4BriefingModel, mapDataUrl: string | null): Promise<Uint8Array> {
  if (typeof document === "undefined") {
    throw new Error("A4 PNG export requires a document canvas");
  }
  const canvas = document.createElement("canvas");
  canvas.width = A4_PNG_PX.w;
  canvas.height = A4_PNG_PX.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  let mapImage: HTMLImageElement | null = null;
  if (mapDataUrl) {
    mapImage = new Image();
    mapImage.src = mapDataUrl;
    await mapImage.decode();
  }
  paintA4Png(ctx, model, mapImage);
  const dataUrl = canvas.toDataURL("image/png");
  const bin = atob(dataUrl.split(",")[1] ?? "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
