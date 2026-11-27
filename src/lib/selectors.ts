import { NODATA } from "./constants";
import { median } from "./format";
import type { CatMode, ColorBy, HistRow, Measure, Model } from "../data/types";
import { CATEGORY_MODES, MEASURES, SIN_PRECIO } from "./constants";

export const isCatMode = (c: ColorBy): c is CatMode => c in CATEGORY_MODES;
export const measureOf = (c: ColorBy): Measure => (c in MEASURES ? (c as Measure) : "consumo");

export interface Filters { dep: string; fin: string }

/** Función que dice si el inmueble i pasa los filtros de dependencia y fin de recibo */
export function makePasses(model: Model, { dep, fin }: Filters): (i: number) => boolean {
  const di = dep ? model.deps.indexOf(dep) : -1;
  const noDep = !dep;
  const { depIdx, finCat } = model;
  const finOk = (c: number) => (fin === "" ? true : fin === "enefeb" ? c === 1 || c === 2 : fin === "2026-01" ? c === 1 : fin === "2026-02" ? c === 2 : c === 0);
  return (i) => (noDep || depIdx[i] === di) && finOk(finCat[i]);
}

export const matrixOf = (model: Model, m: Measure): Float64Array => (m === "consumo" ? model.kwh : m === "demanda" ? model.kw : model.pr);

export interface Agg {
  count: number; nk: number; total: number;
  /** Inmuebles con demanda máxima registrada en el mes: de ellos sale avg.demanda */
  nd: number;
  avg: { consumo: number; demanda: number; precio: number };
  top?: string | null; topShare?: number; color: string;
}

/** Agregados de un grupo (zona o subgrupo) para el mes, la medida y los filtros actuales */
export function aggregate(model: Model, list: Int32Array, mi: number, colorBy: ColorBy, passes: (i: number) => boolean): Agg {
  const { M, kwh, kw, pr, sub, est } = model;
  let total = 0, nk = 0, kwhPriced = 0, subPriced = 0, count = 0;
  const ks: number[] = [], ds: number[] = [], ps: number[] = [];
  const cat = isCatMode(colorBy) ? colorBy : null;
  const counts = cat ? new Int32Array(model.cats[cat].labels.length) : null;
  for (let n = 0; n < list.length; n++) {
    const i = list[n];
    if (!passes(i)) continue;
    count++;
    if (counts) { const c = model.catIdx[cat!][i]; if (c >= 0) counts[c]++; }
    const o = i * M + mi, k = kwh[o], d = kw[o], p = pr[o], s = sub[o];
    // Un mes de lectura estimada no es consumo: no entra al total ni a la mediana
    if (isFinite(k) && !est[o]) {
      total += k; nk++; ks.push(k);
      // Precio de la zona, sin IVA y ponderado por kWh: Σ subtotal / Σ kWh de los meses con precio comparable
      if (isFinite(p) && isFinite(s) && k > 0) { kwhPriced += k; subPriced += s; ps.push(p); }
    }
    if (isFinite(d)) ds.push(d);
  }
  // El color usa la mediana por inmueble: unos pocos sitios grandes no tiñen toda la zona
  const avg = { consumo: median(ks), demanda: median(ds), precio: kwhPriced ? subPriced / kwhPriced : NaN };
  const tot = nk ? total : NaN;
  if (cat && counts) {
    let top = -1, tn = 0;
    for (let c = 0; c < counts.length; c++) if (counts[c] > tn) { top = c; tn = counts[c]; }
    return { count, nk, nd: ds.length, total: tot, avg, top: top >= 0 ? model.cats[cat].labels[top] : null, topShare: count ? tn / count : 0, color: top >= 0 ? model.cats[cat].colors[top] || NODATA : NODATA };
  }
  const m = measureOf(colorBy);
  const v = m === "precio" ? median(ps) : avg[m];
  const sc = model.scales[m];
  let i = -1;
  if (isFinite(v) && v > 0) { i = 0; while (i < sc.breaks.length && v >= sc.breaks[i]) i++; }
  return { count, nk, nd: ds.length, total: tot, avg, color: i < 0 ? NODATA : sc.colors[i] };
}

/** Historial completo de un inmueble, reconstruido de las columnas planas */
export function histOf(model: Model, i: number): HistRow[] {
  const out: HistRow[] = [];
  for (let j = model.histOff[i]; j < model.histOff[i + 1]; j++) {
    const t = model.hKey[j] + 24000, y = Math.floor(t / 12), m = (t % 12) + 1;
    const est = model.hEst[j] === 1, dud = model.hDud[j] === 1, ori = model.hOri[j];
    out.push({
      key: `${y}-${String(m).padStart(2, "0")}`,
      kwh: est ? NaN : model.hKwh[j], kw: dud ? NaN : model.hKw[j], sub: model.hSub[j], pr: model.hPrS[j],
      est, dud, sinPr: ori > 0 ? SIN_PRECIO[ori - 1] ?? null : null
    });
  }
  return out;
}
