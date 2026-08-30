/**
 * Pre-baked CVI → RGBA / CSS lookups. Packed once at module load so the
 * 60 FPS extrusion path never allocates a 4-tuple or rgba() string.
 */
import { cviColor } from "../epidemiology-engine";

export const CVI_LUT_SIZE = 101;
export const CVI_RGBA_LUT = new Uint8Array(CVI_LUT_SIZE * 4);
export const CVI_CSS_LUT: string[] = new Array(CVI_LUT_SIZE);

const RGBA_SCRATCH: [number, number, number, number] = [16, 185, 129, 210];

for (let i = 0; i < CVI_LUT_SIZE; i += 1) {
  const color = cviColor(i);
  const o = i * 4;
  CVI_RGBA_LUT[o] = color[0];
  CVI_RGBA_LUT[o + 1] = color[1];
  CVI_RGBA_LUT[o + 2] = color[2];
  CVI_RGBA_LUT[o + 3] = color[3];
  CVI_CSS_LUT[i] = `rgba(${color[0]},${color[1]},${color[2]},${color[3] / 255})`;
}

export function cviLutIndex(cvi: number): number {
  if (cvi <= 0) return 0;
  if (cvi >= 100) return 100;
  return cvi < 0 ? 0 : Math.round(cvi);
}

export function cviRgbaInto(
  cvi: number,
  out: [number, number, number, number] = RGBA_SCRATCH,
): [number, number, number, number] {
  const o = cviLutIndex(cvi) * 4;
  out[0] = CVI_RGBA_LUT[o];
  out[1] = CVI_RGBA_LUT[o + 1];
  out[2] = CVI_RGBA_LUT[o + 2];
  out[3] = CVI_RGBA_LUT[o + 3];
  return out;
}

export function cviCss(cvi: number): string {
  return CVI_CSS_LUT[cviLutIndex(cvi)];
}
