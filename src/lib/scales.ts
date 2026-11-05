import { RAMP } from "./constants";
import type { Scale } from "../data/types";

/* Escala de color logarítmica: rango = percentiles 2–98 de los valores > 0; cortes en la serie 1-2-5 dentro
   del rango. Si salen menos de 5 clases (el precio) se usa la serie ×1.26; si salen más de 13, la 1-3. */
const SERIES = [
  { nombre: "1-2-5", m: [1, 2, 5] },
  { nombre: "1-3", m: [1, 3.1623] },
  { nombre: "×1.26", m: [1, 1.25, 1.6, 2, 2.5, 3.2, 4, 5, 6.3, 8] }
];
function cortes(lo: number, hi: number, m: number[]): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)) - 1; e <= Math.ceil(Math.log10(hi)) + 1; e++)
    for (const f of m) { const v = +(f * 10 ** e).toPrecision(3); if (v > lo && v < hi) out.push(v); }
  return out;
}
export function rampColors(n: number): string[] {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hex = (c: number[]) => "#" + c.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
  if (n <= 1) return [RAMP[RAMP.length - 1]];
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * (RAMP.length - 1), k = Math.min(RAMP.length - 2, Math.floor(t)), f = t - k;
    const a = rgb(RAMP[k]), b = rgb(RAMP[k + 1]);
    return hex(a.map((x, j) => x + (b[j] - x) * f));
  });
}
/** values: todos los valores > 0 y finitos de la medida (ya ordenados de menor a mayor) */
export function makeScale(sorted: Float64Array): Scale {
  const n = sorted.length;
  const q = (t: number) => (n ? sorted[Math.min(n - 1, Math.floor(t * (n - 1)))] : NaN);
  const p2 = q(0.02), p98 = q(0.98);
  let serie = SERIES[0], breaks = n ? cortes(p2, p98, serie.m) : [];
  if (n && breaks.length + 1 > 13) { serie = SERIES[1]; breaks = cortes(p2, p98, serie.m); }
  if (n && breaks.length + 1 < 5) { serie = SERIES[2]; breaks = cortes(p2, p98, serie.m); }
  return { p2, p98, median: q(0.5), breaks, serie: serie.nombre, colors: rampColors(breaks.length + 1) };
}
/** -1 = sin dato o 0 (gris); 0..n = clase. Debajo del p2 cae en la primera y arriba del p98 en la última. */
export function classOf(v: number, breaks: number[]): number {
  if (!isFinite(v) || v <= 0) return -1;
  let i = 0;
  while (i < breaks.length && v >= breaks[i]) i++;
  return i;
}
