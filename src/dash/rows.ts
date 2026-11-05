import type { Model } from "../data/types";

/** Primer año que se muestra: los recibos anteriores se descartan */
export const ANIO_DESDE = 2025;
/** PDBT (Pequeña Demanda en Baja Tensión) aplica hasta 25 kW-mes: arriba de eso el dato no es válido para la tarifa */
export const PDBT_MAX_KW = 25;
/** Tarifas que facturan demanda máxima medida (distribución y capacidad en $/kW) */
export const TAR_DEMANDA = ["GDMTH", "GDMTO"];
/**
 * Demanda máxima permitida para tarifas que no facturan demanda.
 * PDBT: hasta 25 kW-mes (CFE). Domésticas (1, 1A…1F, DAC): la tarifa no fija un tope en kW;
 * se usa el mismo límite de servicio en baja tensión como supuesto. Cámbialo aquí si usas otro.
 */
export const LIMITE_DOMESTICA_KW = 25;
export const esDomestica = (t: string) => /^(1[A-F]?|DAC)$/.test(t);
/** kW máximo permitido de la tarifa, o 0 si no tiene tope (se factura la demanda medida) */
export const limiteKw = (t: string) => (t === "PDBT" ? PDBT_MAX_KW : esDomestica(t) ? LIMITE_DOMESTICA_KW : 0);

/** Mayúsculas, sin acentos ni espacios repetidos: para cruzar municipios de Supabase, CFE y CENACE */
export const normTxt = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
/** «gdmth », «GDMT-H» y «GDMTH» son la misma tarifa: antes se separaban en grupos distintos */
export const normTarifa = (t?: string | null) => normTxt(t ?? "").replace(/^TARIFA\s*/, "").replace(/[\s\-_.]/g, "") || "Sin tarifa";

/** Desglose del costo calculado con la tarifa oficial de CFE (pesos, sin redondear) */
export interface Partes { energia: number; capacidad: number; distribucion: number; transmision: number; otros: number; iva: number }
export const sumPartes = (p: Partes) => p.energia + p.capacidad + p.distribucion + p.transmision + p.otros + p.iva;

/**
 * Un periodo del historial de un recibo.
 * El recibo es el RPU (un archivo por RPU único); cada fila es un mes de su historial,
 * por eso los conteos de «recibos» se hacen con RPU distintos y no con filas.
 */
export interface Row {
  rpu: string;          // número de servicio CFE: identifica el recibo
  i: number; dep: string; mun: string; zona: string; tar: string;
  per: string; yr: number; dias: number;
  kwh: number; kw: number;
  kwOk: boolean;        // demanda utilizable en indicadores (después de la validación)
  hasKw: boolean;       // el registro trae lectura de demanda
  kwOrig: number;       // kW tal como venía del recibo
  kwFix: string;        // motivo si la demanda se reemplazó o descartó; vacío si pasó la validación
  kwMedia: number;      // media de la muestra válida del RPU con la que se reemplazó (NaN si no aplica)
  kwEst: number;        // demanda para indicadores generales: la medida (validada) o la estimada por consumo
  kwSrc: "medida" | "estimada" | "ninguna";
  imp: number;          // importe facturado (0 si el historial no lo trae)
  hasImp: boolean;
  precio: number;       // precio_kwh del historial ($/kWh); en formato 1 es el precio impreso (NaN si no hay)
  fact: number;         // facturado reconstruido: importe, o kWh × precio impreso (NaN si no hay ninguno)
  formato: number;      // formato del recibo del que salió el registro (1 o 2; 0 si no se cargó)
  ajustado: boolean;
  atipico: boolean;     // $/kWh fuera de rango: revisar kWh o importe
  calc: number;         // costo con la tarifa oficial CFE (NaN si no hay tabla para ese municipio/mes)
  partes: Partes | null;
  grupoTar: string;     // grupo tarifario CFE (división/nodo) usado en el cálculo
  tarAprox: boolean;    // se usó la tabla del mes publicado más cercano
  total: number;        // costo que usan los indicadores
  src: "recibo" | "precio" | "cfe" | "none";   // importe del recibo · kWh × precio impreso · tabla CFE · sin costo
  kwhCosto: number;     // kWh de los recibos con costo: base del $/kWh
  nodo: string;         // zona de carga CENACE del municipio
  ultimo: boolean;      // periodo más reciente del RPU (el que trae el archivo como mes facturado)
}

/**
 * RPU del inmueble o del registro de historial. Ajusta aquí si en tu modelo el campo tiene otro nombre:
 * se busca primero por registro (model.hRpu[j]) y después en el inmueble (props[i].rpu).
 */
const rpuDe = (model: Model, i: number, j: number): string => {
  const m = model as any, p = m.props[i] ?? {};
  const v = m.hRpu?.[j] ?? p.rpu ?? p.RPU ?? p.num_servicio ?? p.servicio ?? "";
  return String(v).trim() || `SIN-RPU-${i}`;
};
export const rpuSinDato = (r: Row) => r.rpu.startsWith("SIN-RPU-");

const fin = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);
/** Rango razonable del $/kWh efectivo; fuera de él el registro se marca como atípico */
export const PRECIO_MIN = 0.8, PRECIO_MAX = 10;

/**
 * Aplana el historial que ya está en memoria (el mismo del mapa): no hay otra consulta a Supabase.
 * Un mismo RPU con el mismo periodo repetido (archivos cargados dos veces o historiales que se traslapan)
 * cuenta una sola vez: se conserva el que trae importe, luego el que trae precio impreso, y si empatan el de mayor consumo.
 */
export function buildRows(model: Model): Row[] {
  const zn = new Map(model.zones.map((z) => [z.id, z.nombre]));
  const porClave = new Map<string, Row>();
  for (let i = 0; i < model.N; i++) {
    const p = model.props[i];
    const zona = zn.get(p.zone) ?? "Sin zona", tar = normTarifa(p.tarifa), mun = (p.municipio || "Sin dato").trim();
    for (let j = model.histOff[i]; j < model.histOff[i + 1]; j++) {
      const t = model.hKey[j] + 24000, yr = Math.floor(t / 12), m = (t % 12) + 1;
      if (yr < ANIO_DESDE) continue;
      const kwh = fin(model.hKwh[j]), kw = fin(model.hKw[j]), hasKw = Number.isFinite(model.hKw[j]);
      const imp = model.hImp[j], hasImp = Number.isFinite(imp);
      // Columnas opcionales del historial (ver cargaHistorial en el loader): precio_kwh, formato, ajustado
      const mm = model as any, pr = Number(mm.hPrecio?.[j]), precio = Number.isFinite(pr) && pr > 0 ? pr : NaN;
      const fact = hasImp ? imp : Number.isFinite(precio) && kwh > 0 ? kwh * precio : NaN;
      const pe = Number.isFinite(fact) && kwh > 0 ? fact / kwh : NaN;
      const lim = limiteKw(tar), kwOk = kw > 0 && !(lim && kw > lim);
      const rpu = rpuDe(model, i, j), per = `${yr}-${String(m).padStart(2, "0")}`;
      const src: Row["src"] = hasImp ? "recibo" : Number.isFinite(fact) ? "precio" : "none";
      const r: Row = {
        rpu, i, dep: p.dependencia || "Sin dependencia", mun, zona, tar, per, yr,
        dias: new Date(yr, m, 0).getDate(), kwh, kw, kwOk, hasKw, kwOrig: kw, kwFix: "", kwMedia: NaN, kwEst: 0, kwSrc: "ninguna", imp: hasImp ? imp : 0, hasImp,
        precio, fact, formato: Number(mm.hFmt?.[j]) || 0, ajustado: !!mm.hAjus?.[j], atipico: Number.isFinite(pe) && (pe < PRECIO_MIN || pe > PRECIO_MAX),
        calc: NaN, partes: null, grupoTar: "", tarAprox: false,
        total: Number.isFinite(fact) ? fact : 0, src, kwhCosto: src === "none" ? 0 : kwh, nodo: "Sin nodo", ultimo: false
      };
      const k = rpu + "|" + per, prev = porClave.get(k);
      const q = (x: Row) => (x.hasImp ? 2 : x.src === "precio" ? 1 : 0);
      if (!prev || q(r) > q(prev) || (q(r) === q(prev) && r.kwh > prev.kwh)) porClave.set(k, r);
    }
  }
  const out = [...porClave.values()];
  validarDemanda(out);
  estimarDemanda(out, referenciaFc(out));
  const ult = new Map<string, string>();
  for (const r of out) if ((ult.get(r.rpu) ?? "") < r.per) ult.set(r.rpu, r.per);
  for (const r of out) r.ultimo = ult.get(r.rpu) === r.per;
  return out;
}

/* ── Validación de demanda: se ejecuta antes de cualquier cálculo ── */

/**
 * Un kW es un error de captura cuando es FACTOR_ATIPICO veces (o más) la mediana del propio RPU.
 * Ejemplo: un RPU que marca 16–22 kW todo el año y un mes 36,707 kW (dígitos pegados en el recibo).
 * Los picos normales de verano (2× la mediana o menos) no se tocan.
 */
export const FACTOR_ATIPICO = 3;
/**
 * Un salto de demanda es real si el consumo del mes sube en proporción (verano, más equipo funcionando).
 * Solo se recorta si el kWh creció menos de la mitad de lo que creció el kW respecto a sus medianas.
 */
export const RESPALDO_CONSUMO = 0.5;
/** Meses con lectura mínimos de un RPU para calcular su mediana y su media */
export const MIN_MUESTRA = 3;

const mediana = (v: number[]) => { const a = [...v].sort((x, y) => x - y), k = a.length >> 1; return a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2; };

/**
 * Por cada RPU con lecturas de kW:
 *  1. Atípico: kW ≥ FACTOR_ATIPICO × la mediana de sus meses (con al menos MIN_MUESTRA meses)
 *     y el consumo del mes no acompaña el salto (kWh / mediana kWh < RESPALDO_CONSUMO × kW / mediana kW).
 *  2. Pruebas físicas: kW en cero con consumo; kW menor que la demanda media del mes (kWh / 24 · días);
 *     kW mayor que el máximo de la tarifa (PDBT y domésticas).
 *  3. Cada mes que falla se reemplaza con la media de los meses válidos del mismo RPU
 *     (sin bajar de la demanda media del mes). Si no hay meses válidos, el mes se descarta de los indicadores.
 */
export function validarDemanda(rows: Row[]) {
  const porRpu = new Map<string, Row[]>();
  for (const r of rows) if (r.hasKw) { const l = porRpu.get(r.rpu); if (l) l.push(r); else porRpu.set(r.rpu, [r]); }
  for (const a of porRpu.values()) {
    const motivo = new Map<Row, string>();
    const pos = a.filter((r) => r.kw > 0), med = pos.length >= MIN_MUESTRA ? mediana(pos.map((r) => r.kw)) : NaN;
    const medKwh = pos.length >= MIN_MUESTRA ? mediana(pos.map((r) => r.kwh)) : NaN;
    const sinRespaldo = (r: Row) => !(medKwh > 0) || r.kwh / medKwh < RESPALDO_CONSUMO * (r.kw / med);
    for (const r of a) {
      const lim = limiteKw(r.tar), media = r.kwh / (24 * r.dias);
      if (med > 0 && r.kw >= FACTOR_ATIPICO * med && sinRespaldo(r)) motivo.set(r, `${(r.kw / med).toLocaleString("es-MX", { maximumFractionDigits: 1 })} veces su mediana (${med} kW)`);
      else if (r.kw === 0 && r.kwh > 0) motivo.set(r, "kW en cero con consumo");
      else if (r.kw > 0 && r.kw < media * 0.999) motivo.set(r, "kW menor que la demanda media del consumo");
      else if (lim && r.kw > lim) motivo.set(r, `Excede el máximo de ${r.tar} (${lim} kW)`);
    }
    if (!motivo.size) continue;
    const validos = a.filter((r) => r.kw > 0 && !motivo.has(r));
    const media = validos.length ? validos.reduce((s, r) => s + r.kw, 0) / validos.length : NaN;
    for (const [r, m] of motivo) {
      const lim = limiteKw(r.tar), nuevo = Math.max(media, r.kwh / (24 * r.dias));
      if (Number.isFinite(media) && !(lim && nuevo > lim)) {
        r.kw = Math.round(nuevo * 10) / 10; r.kwOk = true; r.kwMedia = media;
        r.kwFix = nuevo > media ? m + " · media ajustada al mínimo del consumo" : m;
      } else { r.kwOk = false; r.kwFix = m + " · sin meses válidos para reemplazar"; }
    }
  }
}

/* ── Estimación de demanda para recibos sin lectura de kW (PDBT, domésticas y meses sin dato) ── */

/** Factor de carga si no hay servicios medidos con qué compararse */
export const FC_DEFECTO = 0.15;
export interface RefFc { fc: number; fcBajo: number; fcAlto: number; n: number; kwhTope: number; origen: string }
const cuantil = (v: number[], q: number) => { const a = [...v].sort((x, y) => x - y); if (!a.length) return NaN; const p = (a.length - 1) * q, i = Math.floor(p); return a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * (p - i); };

/**
 * Factor de carga de referencia (FC = kWh / (24 · días · kW)) sacado de los propios datos:
 * servicios medidos de tamaño parecido a los que no tienen lectura (kW mediano ≤ 25 y kWh mensual
 * hasta el percentil 95 de los no medidos). Se toma la mediana por RPU y luego la mediana entre RPU,
 * para que un servicio con muchos meses no pese más. El rango p25–p75 da la incertidumbre.
 */
export function referenciaFc(rows: Row[]): RefFc {
  const porRpu = new Map<string, Row[]>();
  for (const r of rows) { const l = porRpu.get(r.rpu); if (l) l.push(r); else porRpu.set(r.rpu, [r]); }
  const medidos: { fc: number; kw: number; kwh: number }[] = [], kwhSin: number[] = [];
  for (const a of porRpu.values()) {
    const v = a.filter((r) => r.kwOk && r.kw > 0 && r.kwh > 0);
    if (v.length) medidos.push({ fc: cuantil(v.map((r) => r.kwh / (24 * r.dias * r.kw)), 0.5), kw: cuantil(v.map((r) => r.kw), 0.5), kwh: cuantil(v.map((r) => r.kwh), 0.5) });
    else { const k = a.filter((r) => r.kwh > 0).map((r) => r.kwh); if (k.length) kwhSin.push(cuantil(k, 0.5)); }
  }
  const tope = kwhSin.length ? cuantil(kwhSin, 0.95) : Infinity;
  let base = medidos.filter((x) => x.kw <= PDBT_MAX_KW && x.kwh <= tope), origen = "servicios medidos de tamaño similar";
  if (base.length < 5) { base = medidos; origen = "todos los servicios medidos"; }
  if (!base.length) return { fc: FC_DEFECTO, fcBajo: FC_DEFECTO, fcAlto: FC_DEFECTO, n: 0, kwhTope: tope, origen: "valor por defecto (no hay servicios medidos)" };
  const f = base.map((x) => Math.min(1, x.fc));
  return { fc: cuantil(f, 0.5), fcBajo: cuantil(f, 0.25), fcAlto: cuantil(f, 0.75), n: base.length, kwhTope: tope, origen };
}
/** kW estimado de un mes: kWh / (24 · días · FC), sin pasar del máximo de su tarifa (PDBT 25 kW) */
export const kwPorConsumo = (r: Row, fc: number) => { const e = r.kwh > 0 ? r.kwh / (24 * r.dias * fc) : 0, lim = limiteKw(r.tar); return lim ? Math.min(e, lim) : e; };
export function estimarDemanda(rows: Row[], ref: RefFc) {
  for (const r of rows) {
    if (r.kwOk && r.kw > 0) { r.kwEst = r.kw; r.kwSrc = "medida"; }
    else if (r.kwh > 0) { r.kwEst = kwPorConsumo(r, ref.fc); r.kwSrc = "estimada"; }
    else { r.kwEst = 0; r.kwSrc = "ninguna"; }
  }
}
