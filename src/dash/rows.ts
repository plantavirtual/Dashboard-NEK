import type { Model, SinPrecio } from "../data/types";
import { SIN_PRECIO } from "../lib/constants";
/** Motivo por el que un mes no tiene precio (precio_origen), o "" si tiene precio o no hay dato */
export type PrecioOrigen = SinPrecio | "";

/**
 * Periodo que analiza el tablero (AAAA-MM, ambos incluidos). Los meses fuera de este rango se descartan
 * antes de cualquier cálculo: validación de demanda, estimaciones, costos, gráficas y recuadros.
 * Para cambiar el periodo, edita estas dos líneas.
 */
export const MES_DESDE = "2025-01";
export const MES_HASTA = "2026-02";
/** Primer año del periodo (se conserva por compatibilidad) */
export const ANIO_DESDE = Number(MES_DESDE.slice(0, 4));
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
/**
 * Las domésticas se muestran junto con PDBT en un solo grupo en todo el tablero.
 * Los cálculos (límites, tablas de CFE) siguen usando la tarifa real del recibo (Row.tarCFE).
 */
export const GRUPO_BT = "PDBT y domésticas";
export const esBT = (t: string) => t === "PDBT" || esDomestica(t);
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
  i: number; dep: string; mun: string; zona: string;
  tar: string;          // tarifa para mostrar (las domésticas van dentro de GRUPO_BT)
  tarCFE: string;       // tarifa real del recibo: la que usan los cálculos
  per: string; yr: number; dias: number;
  kwh: number; kw: number;
  kwOk: boolean;        // demanda utilizable en indicadores (después de la validación)
  hasKw: boolean;       // el registro trae lectura de demanda
  kwOrig: number;       // kW tal como venía del recibo
  kwFix: string;        // motivo si la demanda se reemplazó o descartó; vacío si pasó la validación
  kwMedia: number;      // media de la muestra válida del RPU con la que se reemplazó (NaN si no aplica)
  kwEst: number;        // demanda para indicadores generales: la medida (validada) o la estimada por consumo
  kwSrc: "medida" | "estimada" | "ninguna";
  sub: number;          // subtotal del mes sin IVA (historial.subtotal); NaN si no hay
  psi: number;          // precio sin IVA ($/kWh, historial.precio_sin_iva); NaN si el mes no tiene precio comparable
  origen: PrecioOrigen; // de dónde sale el precio, o por qué falta (historial.precio_origen)
  lecEst: boolean;      // mes sin lectura real del medidor: un 0 kWh aquí no es consumo cero
  demDud: boolean;      // demanda marcada como dudosa en Supabase
  consAt: boolean;      // consumo marcado como atípico en Supabase (historial_calculo.consumo_atipico)
  kwhAt: boolean;       // consumo fuera del patrón del propio RPU (lo detecta el tablero; el kWh no se modifica)
  kwhPatron: number;    // kWh que marca el patrón del RPU para ese mes (NaN si no hay patrón)
  formato: number;      // formato del recibo de ese mes (1 o 2; 0 sin dato)
  ajustado: boolean;    // el mes se ajustó al cargar el historial
  contratada: number;   // demanda contratada del inmueble en kW (NaN si no hay dato)
  division: string;     // división tarifaria CFE del inmueble («Golfo Norte», «Golfo Centro»; «Sin división» si no hay)
  zonaDist: string;     // zona de distribución CFE del inmueble
  nodoP: string;        // NodoP capturado en el inmueble (columna «nodo»), si existe
  calc: number;         // costo con la tarifa oficial CFE (NaN si no hay tabla para ese municipio/mes)
  partes: Partes | null;
  grupoTar: string;     // grupo tarifario CFE (división/nodo) usado en el cálculo
  tarAprox: boolean;    // se usó la tabla del mes publicado más cercano
  total: number;        // costo que usan los indicadores
  src: "subtotal" | "cfe" | "none";   // subtotal del recibo (sin IVA) · tabla oficial CFE (sin IVA) · sin costo
  kwhCosto: number;     // kWh de los recibos con costo: base del $/kWh
  nodo: string;         // zona de carga CENACE del municipio
  ultimo: boolean;      // periodo más reciente del RPU (el que trae el archivo como mes facturado)
}

/** RPU del inmueble (buildModel agrupa el historial por el RPU de cada inmueble) */
const rpuDe = (model: Model, i: number): string => model.props[i].rpu.trim() || `SIN-RPU-${i}`;
export const rpuSinDato = (r: Row) => r.rpu.startsWith("SIN-RPU-");

const fin = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);
/** Textos de precio_origen para los meses sin precio (los mismos que usa el mapa) */
export const MOTIVO_SIN_PRECIO: Record<string, string> = {
  consumo_minimo: "Consumo mínimo (el cargo fijo es más de la mitad de lo facturado)",
  atipico: "Precio atípico, en revisión",
  refacturacion: "Refacturación",
  sin_decena: "Precio impreso incompleto",
  lectura_estimada: "Lectura estimada (CFE cobró energía sin imprimir kWh)",
  "": "Sin dato (0 kWh o sin datos para calcular)"
};

/**
 * Aplana el historial que ya está en memoria (el mismo del mapa): no hay otra consulta a Supabase.
 * Un mismo RPU con el mismo periodo repetido (archivos cargados dos veces o historiales que se traslapan)
 * cuenta una sola vez: se conserva el que trae precio sin IVA, luego el que trae subtotal, y si empatan el de mayor consumo.
 */
export function buildRows(model: Model): Row[] {
  const zn = new Map(model.zones.map((z) => [z.id, z.nombre]));
  const porClave = new Map<string, Row>();
  for (let i = 0; i < model.N; i++) {
    const p = model.props[i];
    const zona = zn.get(p.zone) ?? "Sin zona", mun = (p.municipio || "Sin dato").trim();
    for (let j = model.histOff[i]; j < model.histOff[i + 1]; j++) {
      const t = model.hKey[j] + 24000, yr = Math.floor(t / 12), m = (t % 12) + 1;
      const clave = `${yr}-${String(m).padStart(2, "0")}`;
      if (clave < MES_DESDE || clave > MES_HASTA) continue;
      // Tarifa del recibo en ese mes (historial_calculo.tarifa); si no viene, la del inmueble
      const tarCFE = normTarifa(model.hTar?.[j] || p.tarifa), tar = esBT(tarCFE) ? GRUPO_BT : tarCFE;
      const kwh = fin(model.hKwh[j]), kw = fin(model.hKw[j]), hasKw = Number.isFinite(model.hKw[j]);
      // Columnas del mapa: hPrS = precio sin IVA, hOri = motivo sin precio (0 = con precio o sin dato; 1..n = SIN_PRECIO)
      const sub = model.hSub[j], psi = Number.isFinite(model.hPrS[j]) && model.hPrS[j] > 0 ? model.hPrS[j] : NaN;
      const origen: PrecioOrigen = model.hOri[j] ? (SIN_PRECIO[model.hOri[j] - 1] ?? "") : "", lecEst = model.hEst[j] === 1, demDud = model.hDud[j] === 1;
      const lim = limiteKw(tarCFE), kwOk = kw > 0 && !(lim && kw > lim);
      const rpu = rpuDe(model, i), per = `${yr}-${String(m).padStart(2, "0")}`;
      const src: Row["src"] = Number.isFinite(sub) ? "subtotal" : "none";
      const r: Row = {
        rpu, i, dep: p.dependencia || "Sin dependencia", mun, zona, tar, tarCFE, per, yr,
        dias: new Date(yr, m, 0).getDate(), kwh, kw, kwOk, hasKw, kwOrig: kw, kwFix: "", kwMedia: NaN, kwEst: 0, kwSrc: "ninguna",
        sub, psi, origen, lecEst, demDud, consAt: model.hCAt?.[j] === 1, kwhAt: false, kwhPatron: NaN, formato: model.hFmt?.[j] || p.formato || 0, ajustado: model.hAjus?.[j] === 1, contratada: Number.isFinite(p.contratada) && p.contratada > 0 ? p.contratada : NaN, division: p.division || "Sin división", zonaDist: p.zonaDist || "Sin zona de distribución",
        nodoP: p.nodo == null ? "" : String(p.nodo).trim(),
        calc: NaN, partes: null, grupoTar: "", tarAprox: false,
        total: Number.isFinite(sub) ? sub : 0, src, kwhCosto: src === "none" ? 0 : kwh, nodo: "Sin nodo", ultimo: false
      };
      const k = rpu + "|" + per, prev = porClave.get(k);
      const q = (x: Row) => (Number.isFinite(x.psi) ? 2 : x.src === "subtotal" ? 1 : 0);
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
 * Un kW es un error de captura cuando es FACTOR_ATIPICO veces (o más) lo que marca el patrón del propio RPU.
 * Ejemplo: un RPU que marca 16–22 kW todo el año y un mes 36,707 kW (dígitos pegados en el recibo).
 */
export const FACTOR_ATIPICO = 3;
/**
 * Un salto de demanda es real si el consumo del mes sube en proporción (verano, más equipo funcionando)
 * y ese consumo está dentro del patrón. Se corrige si el kWh creció menos de la mitad de lo que creció el kW,
 * o si el kWh también se salió del patrón (los dos saltaron juntos: refacturación, lectura acumulada o captura).
 */
export const RESPALDO_CONSUMO = 0.5;
/** Meses con lectura que necesita un RPU, contando el mes revisado: el patrón sale de los otros (al menos 2) */
export const MIN_MUESTRA = 3;
/** Meses de calor en Tamaulipas (mayo a octubre): el aire acondicionado sube consumo y demanda */
export const MESES_VERANO = [5, 6, 7, 8, 9, 10];
/** En verano se espera hasta el doble de lo que marca el patrón de los meses frescos */
export const FACTOR_VERANO = 2;
/** Con pocos meses, los que forman el patrón deben parecerse: el mayor no puede pasar de este múltiplo del menor */
export const DISPERSION_PATRON = 2;
/** Desde este número de meses de referencia la mediana ya es robusta y no se pide que se parezcan */
export const POCOS_MESES = 6;
export const esVerano = (per: string) => MESES_VERANO.includes(Number(per.slice(5, 7)));
export const NOMBRE_VERANO = "mayo a octubre";

const mediana = (v: number[]) => { const a = [...v].sort((x, y) => x - y), k = a.length >> 1; return a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2; };

/**
 * Patrón de un mes: lo que suelen marcar los OTROS meses del mismo RPU (no se compara contra sí mismo,
 * así un valor disparado no infla su propia referencia, lo que importa cuando hay 3 o 4 meses).
 *  - Si hay 2 o más meses de la misma temporada (verano / resto del año), se usa su mediana.
 *  - Si no, se usa la mediana de todos; si el mes revisado es de verano y la referencia es de meses frescos,
 *    se permite hasta FACTOR_VERANO veces más (aire acondicionado).
 *  - Con menos de POCOS_MESES de referencia se busca el núcleo: el grupo más grande de meses parecidos entre sí
 *    (el mayor no más de DISPERSION_PATRON veces el menor). Debe ser al menos la mitad y 2 meses; si no, no hay patrón.
 * Devuelve el valor esperado (techo normal del mes) o NaN si no hay patrón.
 */
function patron(a: Row[], r: Row, val: (x: Row) => number): number {
  const otros = a.filter((x) => x !== r && val(x) > 0);
  if (otros.length < MIN_MUESTRA - 1) return NaN;
  const ver = esVerano(r.per), misma = otros.filter((x) => esVerano(x.per) === ver);
  const ref = misma.length >= 2 ? misma : otros;
  const v = ref.map(val), mixta = ref !== misma && ref.some((x) => esVerano(x.per)) && ref.some((x) => !esVerano(x.per));
  let base = mediana(v);
  if (ref.length < POCOS_MESES) {
    // Núcleo del patrón: el grupo más grande de meses parecidos entre sí. Con pocos datos otro mes raro
    // (por ejemplo la cola de una refacturación) no debe impedir ver el patrón, pero sí debe haber mayoría.
    const o = [...v].sort((x, y) => x - y), tol = DISPERSION_PATRON * (mixta ? FACTOR_VERANO : 1);
    let ini = 0, fin = 0;
    for (let i = 0, j = 0; i < o.length; i++) { while (o[i] > tol * o[j]) j++; if (i - j > fin - ini) { ini = j; fin = i; } }
    const nucleo = o.slice(ini, fin + 1);
    if (nucleo.length < Math.max(2, Math.ceil(o.length / 2))) return NaN;
    base = mediana(nucleo);
  }
  return ver && ref !== misma && !ref.some((x) => esVerano(x.per)) ? base * FACTOR_VERANO : base;
}
/**
 * Un valor que se repite no es un error: si otro mes del RPU marca algo parecido (no más de DISPERSION_PATRON veces
 * de diferencia), el inmueble de verdad llega a ese nivel (cambio de nivel, temporada de más uso) y el dato se respeta.
 * Los errores de captura y las refacturaciones son meses sueltos.
 */
function repetido(a: Row[], r: Row, val: (x: Row) => number): boolean {
  const v = val(r);
  return a.some((x) => x !== r && val(x) > 0 && Math.max(v, val(x)) <= DISPERSION_PATRON * Math.min(v, val(x)));
}
/** Saltos mínimos para revisar un mes: debajo de esto la diferencia no cambia ningún indicador (servicios casi sin uso) */
export const MIN_KWH_ATIPICO = 300;
export const MIN_KW_ATIPICO = 5;
const fmt1 = (x: number) => x.toLocaleString("es-MX", { maximumFractionDigits: 1 });

/**
 * Consumo fuera de patrón: kWh ≥ FACTOR_ATIPICO veces lo que marcan los otros meses del RPU (con la holgura de verano).
 * No cambia el kWh ni el costo (es lo que se facturó); sirve para no usar ese kWh como respaldo de un pico de kW
 * ni para estimar demanda con él.
 */
export function validarConsumo(rows: Row[]) {
  const porRpu = new Map<string, Row[]>();
  for (const r of rows) if (r.kwh > 0 && !r.lecEst) { const l = porRpu.get(r.rpu); if (l) l.push(r); else porRpu.set(r.rpu, [r]); }
  for (const a of porRpu.values()) for (const r of a) {
    const esp = patron(a, r, (x) => x.kwh);
    r.kwhPatron = esp;
    r.kwhAt = esp > 0 && r.kwh >= FACTOR_ATIPICO * esp && r.kwh >= MIN_KWH_ATIPICO && !repetido(a, r, (x) => x.kwh);
  }
}

/**
 * Por cada RPU con lecturas de kW:
 *  0. Demanda dudosa: el mes viene marcado en Supabase (historial.demanda_dudosa).
 *  1. Fuera de patrón: kW ≥ FACTOR_ATIPICO × el patrón de sus otros meses, el consumo no respalda el salto
 *     (no subió en proporción, o también se salió de su patrón) y es un mes suelto (ningún otro mes marca algo parecido).
 *  2. Pruebas físicas: kW en cero con consumo; kW menor que la demanda media del mes (kWh / 24 · días);
 *     kW mayor que el máximo de la tarifa (PDBT y domésticas).
 *  3. Cada mes que falla se reemplaza con la media de los meses válidos del mismo RPU, de la misma temporada si los hay
 *     (sin bajar de la demanda media del consumo, cuando ese consumo es confiable). Sin meses válidos, se descarta.
 */
export function validarDemanda(rows: Row[]) {
  validarConsumo(rows);
  const porRpu = new Map<string, Row[]>();
  for (const r of rows) if (r.hasKw) { const l = porRpu.get(r.rpu); if (l) l.push(r); else porRpu.set(r.rpu, [r]); }
  for (const a of porRpu.values()) {
    const motivo = new Map<Row, string>();
    const pos = a.filter((r) => r.kw > 0 && !r.demDud);
    const consumoMalo = (r: Row) => r.kwhAt || r.consAt;
    for (const r of a) {
      const lim = limiteKw(r.tarCFE), media = r.kwh / (24 * r.dias);
      const esp = pos.includes(r) ? patron(pos, r, (x) => x.kw) : NaN;
      const espKwh = patron(pos, r, (x) => x.kwh);
      const sinRespaldo = consumoMalo(r) || !(espKwh > 0) || r.kwh / espKwh < RESPALDO_CONSUMO * (r.kw / esp);
      if (r.demDud) motivo.set(r, "Marcada como dudosa en Supabase");
      else if (esp > 0 && r.kw >= FACTOR_ATIPICO * esp && r.kw >= MIN_KW_ATIPICO && sinRespaldo && !repetido(pos, r, (x) => x.kw))
        motivo.set(r, `${fmt1(r.kw / esp)} veces su patrón (${fmt1(esp)} kW${esVerano(r.per) ? ", ya con la holgura de verano" : ""})` + (consumoMalo(r) ? " · el consumo también salió de su patrón" : ""));
      else if (r.kw === 0 && r.kwh > 0 && !r.lecEst) motivo.set(r, "kW en cero con consumo");
      else if (r.kw > 0 && r.kw < media * 0.999 && !consumoMalo(r)) motivo.set(r, "kW menor que la demanda media del consumo");
      else if (lim && r.kw > lim) motivo.set(r, `Excede el máximo de ${r.tarCFE} (${lim} kW)`);
    }
    if (!motivo.size) continue;
    const validos = a.filter((r) => r.kw > 0 && !motivo.has(r));
    for (const [r, m] of motivo) {
      const misma = validos.filter((x) => esVerano(x.per) === esVerano(r.per)), base = misma.length ? misma : validos;
      const media = base.length ? base.reduce((s, x) => s + x.kw, 0) / base.length : NaN;
      // Si el consumo del mes también está fuera de patrón, el piso sale del consumo esperado y no del facturado
      const kwhPiso = consumoMalo(r) ? (r.kwhPatron > 0 ? r.kwhPatron : 0) : r.kwh;
      const lim = limiteKw(r.tarCFE), nuevo = Math.max(media, kwhPiso / (24 * r.dias));
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
    const v = a.filter((r) => r.kwOk && r.kw > 0 && r.kwh > 0 && !r.lecEst && !r.kwhAt);
    if (v.length) medidos.push({ fc: cuantil(v.map((r) => r.kwh / (24 * r.dias * r.kw)), 0.5), kw: cuantil(v.map((r) => r.kw), 0.5), kwh: cuantil(v.map((r) => r.kwh), 0.5) });
    else { const k = a.filter((r) => r.kwh > 0 && !r.lecEst && !r.kwhAt).map((r) => r.kwh); if (k.length) kwhSin.push(cuantil(k, 0.5)); }
  }
  const tope = kwhSin.length ? cuantil(kwhSin, 0.95) : Infinity;
  let base = medidos.filter((x) => x.kw <= PDBT_MAX_KW && x.kwh <= tope), origen = "servicios medidos de tamaño similar";
  if (base.length < 5) { base = medidos; origen = "todos los servicios medidos"; }
  if (!base.length) return { fc: FC_DEFECTO, fcBajo: FC_DEFECTO, fcAlto: FC_DEFECTO, n: 0, kwhTope: tope, origen: "valor por defecto (no hay servicios medidos)" };
  const f = base.map((x) => Math.min(1, x.fc));
  return { fc: cuantil(f, 0.5), fcBajo: cuantil(f, 0.25), fcAlto: cuantil(f, 0.75), n: base.length, kwhTope: tope, origen };
}
/** kW estimado de un mes: kWh / (24 · días · FC), sin pasar del máximo de su tarifa (PDBT 25 kW) */
export const kwPorConsumo = (r: Row, fc: number) => { const e = r.kwh > 0 ? r.kwh / (24 * r.dias * fc) : 0, lim = limiteKw(r.tarCFE); return lim ? Math.min(e, lim) : e; };
export function estimarDemanda(rows: Row[], ref: RefFc) {
  for (const r of rows) {
    if (r.kwOk && r.kw > 0) { r.kwEst = r.kw; r.kwSrc = "medida"; }
    // Meses con lectura estimada: su kWh no es real, así que no se estima demanda con él
    // Consumo fuera de patrón: la demanda se estima con el kWh que marca el patrón, no con el facturado
    else if (r.kwh > 0 && !r.lecEst) { r.kwEst = r.kwhAt && r.kwhPatron > 0 ? kwPorConsumo({ ...r, kwh: r.kwhPatron }, ref.fc) : kwPorConsumo(r, ref.fc); r.kwSrc = "estimada"; }
    else { r.kwEst = 0; r.kwSrc = "ninguna"; }
  }
}
