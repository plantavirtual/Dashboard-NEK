export const nfInt = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
export const nf1 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const nf2 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

import { MES_CORTO } from "./constants";
import type { Measure } from "../data/types";

export const ok = (v: unknown): v is number => typeof v === "number" && isFinite(v);

export function fmtEnergy(v: number): string {
  if (!ok(v)) return "—";
  if (v < 10000) return nfInt.format(v) + " kWh";
  if (v < 1e6) return (v < 1e5 ? nf1.format(v / 1e3) : nfInt.format(v / 1e3)) + " MWh";
  return nf2.format(v / 1e6) + " GWh";
}
export const fmtPrice = (v: number) => (ok(v) ? "$" + nf2.format(v) + "/kWh" : "—");
export const fmtKw = (v: number) => (ok(v) ? (v < 100 ? nf1.format(v) : nfInt.format(v)) + " kW" : "—");
export const fmtMoney = (v: number) => (ok(v) ? "$" + nfInt.format(v) : "—");
export function fmtMeasure(measure: Measure, v: number): string {
  return measure === "consumo" ? fmtEnergy(v) : measure === "precio" ? fmtPrice(v) : fmtKw(v);
}
/** Etiquetas compactas para los cortes de la leyenda */
export function fmtCorte(measure: Measure, v: number): string {
  const n = v >= 1000
    ? (v / 1000).toLocaleString("es-MX", { maximumFractionDigits: 1 }) + "k"
    : v.toLocaleString("es-MX", { maximumFractionDigits: 2 });
  return measure === "precio" ? "$" + n : n;
}
export function normName(t: unknown): string {
  return String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    .replace(/^(ciudad|cd\.?)\s+/, "").replace(/\s+/g, " ");
}
export const mean = (arr: ArrayLike<number>): number => {
  let s = 0, n = 0;
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (isFinite(v)) { s += v; n++; } }
  return n ? s / n : NaN;
};
export function median(a: number[]): number {
  if (!a.length) return NaN;
  a.sort((x, y) => x - y);
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}
export function shortNum(v: number): string {
  if (v >= 1e6) return nf1.format(v / 1e6) + "M";
  if (v >= 1e4) return nfInt.format(v / 1e3) + "k";
  if (v >= 1e3) return nf1.format(v / 1e3) + "k";
  return v < 10 && v % 1 ? nf1.format(v) : nfInt.format(v);
}
export const keyLabel = (k: string): string => {
  const [y, m] = k.split("-").map(Number);
  return `${MES_CORTO[m - 1]} ${y}`;
};
export function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
