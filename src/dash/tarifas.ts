import { normTarifa, normTxt, sumPartes, type Partes, type Row } from "./rows";

/* ── Datos oficiales generados por los scripts de /scripts (CFE y CENACE) ── */

export type Unidad = "$/mes" | "$/kWh" | "$/kW";
export interface Cargo { v: number; u: Unidad }
/** Claves: fijo, suministro, transmision, distribucion, cenace, scnmem, energia, energia_base, energia_intermedia, energia_semipunta, energia_punta, capacidad */
export type Cargos = Record<string, Cargo>;
/** Municipios que CFE factura con la misma tabla (misma división tarifaria / nodo) */
export interface GrupoTarifa { id: string; division: string; municipios: string[]; meses: Record<string, Cargos> }
export interface TarifaOficial { url: string; grupos: GrupoTarifa[] }
export interface TarifasJson { generado: string; estado: string; fuente: string; tarifas: Record<string, TarifaOficial> }
export interface NodoP {
  clave: string; nombre: string; tipo: string; sistema: string; ccr: string; zonaCarga: string; tension: string;
  estado: string; municipio: string; claveMun?: string; region: string;
  zonaTrans?: string; zonaDist?: string; division?: string;   // división de distribución CFE (p. ej. GOLFO NORTE)
}
export interface NodosJson { generado: string; version: string; fuente: string; nodos: NodoP[] }
export interface Oficial { tar: TarifasJson | null; nodos: NodosJson | null; errores: string[] }

const BASE: string = (import.meta as any).env?.BASE_URL ?? "/";
export const URL_TARIFAS = BASE + "data/tarifas-cfe-tamaulipas.json";
export const URL_NODOS = BASE + "data/nodosp-tamaulipas.json";

async function getJson<T>(u: string): Promise<T> {
  const r = await fetch(u, { cache: "no-cache" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export async function cargarOficial(): Promise<Oficial> {
  const [a, b] = await Promise.allSettled([getJson<TarifasJson>(URL_TARIFAS), getJson<NodosJson>(URL_NODOS)]);
  const errores: string[] = [];
  if (a.status === "rejected") errores.push(`Tarifas CFE (${URL_TARIFAS}): ${a.reason?.message ?? a.reason}`);
  if (b.status === "rejected") errores.push(`NodosP CENACE (${URL_NODOS}): ${b.reason?.message ?? b.reason}`);
  return { tar: a.status === "fulfilled" ? a.value : null, nodos: b.status === "fulfilled" ? b.value : null, errores };
}

/* ── Parámetros del cálculo: ajústalos contra un recibo real ── */

export const IVA = 0.16;
/** Reparto del consumo GDMTH por periodo horario cuando el recibo no trae kWh base/intermedia/punta */
export const PERFIL_HORARIO: Record<string, number> = { base: 0.2, intermedia: 0.62, semipunta: 0, punta: 0.18 };
/** Factor de carga de las disposiciones de la tarifa: demanda facturable = mín(kW máx., kWh / (24 · días · FC)) */
export const FACTOR_CARGA: Record<string, number> = { GDMTH: 0.57, GDMTO: 0.55 };

export const COLS_CARGO: [string, string][] = [
  ["fijo", "Fijo"], ["suministro", "Suministro"], ["transmision", "Transmisión"], ["distribucion", "Distribución"],
  ["cenace", "CENACE"], ["scnmem", "SCnMEM"], ["energia", "Energía"], ["energia_base", "Energía base"],
  ["energia_intermedia", "Energía intermedia"], ["energia_semipunta", "Energía semipunta"], ["energia_punta", "Energía punta"], ["capacidad", "Capacidad"]
];
export const PARTES: [keyof Partes, string][] = [
  ["energia", "Energía"], ["capacidad", "Capacidad"], ["distribucion", "Distribución"], ["transmision", "Transmisión"],
  ["otros", "Fijo, suministro, CENACE y SCnMEM"], ["iva", "IVA"]
];
const HORARIO = ["energia_base", "energia_intermedia", "energia_semipunta", "energia_punta"];

/** Costo de un recibo con la tabla oficial: $/mes × 1, $/kWh × kWh, $/kW × demanda facturable */
export function costoTarifa(tar: string, c: Cargos, kwh: number, kw: number, dias: number): Partes {
  const fc = FACTOR_CARGA[tar];
  const dFact = kw > 0 ? (fc && kwh > 0 ? Math.min(kw, kwh / (24 * dias * fc)) : kw) : 0;
  const p: Partes = { energia: 0, capacidad: 0, distribucion: 0, transmision: 0, otros: 0, iva: 0 };
  const hor = HORARIO.filter((k) => c[k]);
  if (hor.length) {
    let w = 0, s = 0;
    for (const k of hor) { const sh = PERFIL_HORARIO[k.slice(8)] ?? 0; s += sh * c[k].v; w += sh; }
    p.energia += kwh * (w ? s / w : 0);
  }
  for (const [k, { v, u }] of Object.entries(c)) {
    if (k.startsWith("energia_") || (k === "energia" && hor.length)) continue;
    const val = v * (u === "$/mes" ? 1 : u === "$/kWh" ? kwh : dFact);
    if (k === "energia" || k === "capacidad" || k === "distribucion" || k === "transmision") p[k] += val; else p.otros += val;
  }
  p.iva = (p.energia + p.capacidad + p.distribucion + p.transmision + p.otros) * IVA;
  return p;
}

type Busca = (tar: string, mun: string, per: string) => { c: Cargos; g: GrupoTarifa; aprox: boolean } | null;
/** tarifa → municipio → grupo; si falta el mes exacto usa el publicado más cercano (anterior, o el primero) */
export function indiceTarifas(t: TarifasJson | null): Busca {
  const idx = new Map<string, Map<string, GrupoTarifa>>();
  for (const [tar, o] of Object.entries(t?.tarifas ?? {})) {
    const m = new Map<string, GrupoTarifa>();
    for (const g of o.grupos) for (const mu of g.municipios) m.set(normTxt(mu), g);
    idx.set(normTarifa(tar), m);
  }
  const meses = new Map<GrupoTarifa, string[]>();
  return (tar, mun, per) => {
    const m = idx.get(tar), g = m?.get(normTxt(mun)) ?? m?.get("*");
    if (!g) return null;
    if (g.meses[per]) return { c: g.meses[per], g, aprox: false };
    let ms = meses.get(g);
    if (!ms) { ms = Object.keys(g.meses).sort(); meses.set(g, ms); }
    let best = "";
    for (const k of ms) if (k <= per) best = k;
    best ||= ms[0] ?? "";
    return best ? { c: g.meses[best], g, aprox: true } : null;
  };
}

/**
 * Zona de carga CENACE: primero por el NodoP capturado en el inmueble (columna «nodo»);
 * si no viene o no está en el catálogo, por el municipio (la zona de carga más frecuente entre sus NodosP).
 */
export function indiceNodos(n: NodosJson | null) {
  const cnt = new Map<string, Map<string, number>>(), porClave = new Map<string, string>();
  for (const nd of n?.nodos ?? []) {
    if (!nd.zonaCarga) continue;
    if (nd.clave) porClave.set(normTxt(nd.clave), nd.zonaCarga);
    if (!nd.municipio) continue;
    const k = normTxt(nd.municipio), m = cnt.get(k) ?? new Map<string, number>();
    m.set(nd.zonaCarga, (m.get(nd.zonaCarga) ?? 0) + 1); cnt.set(k, m);
  }
  const porMun = new Map<string, string>();
  for (const [k, m] of cnt) porMun.set(k, [...m].sort((a, b) => b[1] - a[1])[0][0]);
  return (nodoP: string, mun: string) => (nodoP && porClave.get(normTxt(nodoP))) || porMun.get(normTxt(mun)) || "Sin nodo";
}

/**
 * Costo de cada mes de historial:
 *  · GDMTH → con la tabla oficial CFE de su grupo (nodo) y mes; lo facturado queda para comparar.
 *  · Resto → importe del recibo (formato 2); si no lo trae, kWh × precio impreso (formato 1);
 *    si tampoco hay precio, la tabla oficial; si no hay tabla, sin costo.
 */
export function aplicarOficial(rows: Row[], of: Oficial | null): Row[] {
  const tf = indiceTarifas(of?.tar ?? null), nz = indiceNodos(of?.nodos ?? null);
  return rows.map((r) => {
    const t = tf(r.tarCFE, r.mun, r.per);
    const partes = t ? costoTarifa(r.tarCFE, t.c, r.kwh, r.kw, r.dias) : null;
    const calc = partes ? sumPartes(partes) : NaN;
    let total = 0, src: Row["src"] = "none";
    if (r.tarCFE === "GDMTH" && partes) { total = calc; src = "cfe"; }
    else if (r.hasImp) { total = r.imp; src = "recibo"; }
    else if (Number.isFinite(r.fact)) { total = r.fact; src = "precio"; }
    else if (partes) { total = calc; src = "cfe"; }
    return { ...r, calc, partes, grupoTar: t?.g.division ?? "", tarAprox: t?.aprox ?? false, total, src,
      kwhCosto: src === "none" ? 0 : r.kwh, nodo: nz(r.nodoP, r.mun) };
  });
}
