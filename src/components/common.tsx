import { FEATURE_LABEL, MES_CORTO, NODATA } from "../lib/constants";
import { mean } from "../lib/format";
import { classOf } from "../lib/scales";
import type { HistRow, Measure, Model, Prop } from "../data/types";

/** Fotovoltaico / NETMET y medidor bidireccional */
export function FeatChips({ p }: { p: Prop }) {
  return (
    <>
      {p.feature && <span className="chip sol">{FEATURE_LABEL[p.feature] || p.feature}</span>}
      {p.bidir && <span className="chip peri">Medidor bidireccional</span>}
    </>
  );
}

export function colorForValue(model: Model, measure: Measure, v: number): string {
  const sc = model.scales[measure];
  const c = classOf(v, sc.breaks);
  return c < 0 ? NODATA : sc.colors[c];
}

/** Promedios de un conjunto de meses del historial. El precio es sin IVA y ponderado por kWh: Σ subtotal / Σ kWh de
    los meses con precio comparable (la misma fórmula que las píldoras de zona). nk, nw, ns, np: cuántos meses tienen
    consumo, demanda, subtotal y precio. Los meses de lectura estimada y de demanda dudosa ya vienen en NaN. */
export function histStats(h: HistRow[]) {
  const m = (f: (r: HistRow) => number) => mean(h.map(f));
  const c = (f: (r: HistRow) => number) => h.filter((r) => isFinite(f(r))).length;
  let sk = 0, ss = 0, np = 0;
  for (const r of h) if (isFinite(r.pr) && isFinite(r.sub) && isFinite(r.kwh) && r.kwh > 0) { sk += r.kwh; ss += r.sub; np++; }
  return {
    n: h.length, kwh: m((r) => r.kwh), kw: m((r) => r.kw), sub: m((r) => r.sub), pr: sk ? ss / sk : NaN,
    nk: c((r) => r.kwh), nw: c((r) => r.kw), ns: c((r) => r.sub), np,
    desde: h.length ? h[0].key : null, hasta: h.length ? h[h.length - 1].key : null
  };
}

/** Últimos 12 meses: los 12 meses calendario que terminan en el último mes con historial del inmueble */
export function ventana12(hist: HistRow[]): { ini: string | null; fin: string | null; h: HistRow[] } {
  if (!hist.length) return { ini: null, fin: null, h: [] };
  const fin = hist[hist.length - 1].key, [y, m] = fin.split("-").map(Number), t = y * 12 + m - 1 - 11;
  const ini = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  return { ini, fin, h: hist.filter((r) => r.key >= ini) };
}

export function endLabel(p: Prop, model: Model): string {
  if (!p.endKey) return "Sin dato";
  const [y, m] = p.endKey.split("-").map(Number);
  const raw = model.hasEndColumn && p.endRaw && String(p.endRaw).length >= 10 ? +String(p.endRaw).slice(8, 10) + " " : "";
  const outside = p.endKey < model.months[0].key ? " (antes de la línea de tiempo)"
    : p.endKey > model.months[model.months.length - 1].key ? " (después de la línea de tiempo)" : "";
  return `${raw}${MES_CORTO[m - 1]} ${y}${outside}`;
}
