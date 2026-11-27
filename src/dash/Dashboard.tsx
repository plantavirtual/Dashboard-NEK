import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./dashboard.css";
import { useStore } from "../store";
import { TARIFA_COLORS } from "../lib/constants";
import { esDomestica, MES_DESDE, MES_HASTA, FACTOR_ATIPICO, GRUPO_BT, normTarifa, FC_DEFECTO, LIMITE_DOMESTICA_KW, MIN_MUESTRA, PDBT_MAX_KW, FACTOR_VERANO, NOMBRE_VERANO, DISPERSION_PATRON, MIN_KW_ATIPICO, MIN_KWH_ATIPICO, MOTIVO_SIN_PRECIO, RESPALDO_CONSUMO, TAR_DEMANDA, buildRows, kwPorConsumo, limiteKw, normTxt, referenciaFc, type Row } from "./rows";
import { aplicarOficial, cargarOficial, type Oficial } from "./tarifas";

type Cfg = any;
type Tab = "pg" | "co" | "dm" | "pc" | "np";
type GK = "tar" | "div" | "zona" | "nodo" | "dep" | "mun";

const P = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Montos: menos de un millón, la cifra exacta con centavos ($234,567.89); desde un millón, en millones con 2 decimales ($35.54 M) */
const M = (n: number) => (Math.abs(n) < 1e6 ? P(n) : "$" + (n / 1e6).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " M");
const N = (n: number) => Math.round(n).toLocaleString("es-MX");
const KW = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 1 }) + " kW";
/** kW → megawatts con 2 decimales */
const MW = (kw: number) => (kw / 1000).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " MW";
const PCT = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "0.0") + " %";

const PAL = {
  light: { c: ["#ab0033", "#bc955c", "#54565a", "#ddc9a3", "#cd6685"], card: "#fff", mut: "#54565a", bd: "#e6dcc6",
    x: ["#ab0033", "#bc955c", "#54565a", "#ddc9a3", "#cd6685", "#6e1423", "#8a6a3a", "#9a9da2", "#e9b8c6", "#3a3c40", "#c9a77a", "#7d2e46"] },
  dark: { c: ["#d9355a", "#bc955c", "#ddc9a3", "#8e9094", "#e89aae"], card: "#25272a", mut: "#b4afa5", bd: "#3a3c40",
    x: ["#d9355a", "#bc955c", "#ddc9a3", "#8e9094", "#e89aae", "#f07a93", "#e0c08f", "#c4c6ca", "#a8596f", "#6f7277", "#f4e1bf", "#b7425f"] }
};
/** Orden fijo de tarifas para que cada una conserve su color en todas las gráficas de demanda */
const ORDEN_TAR = ["GDMTH", "GDMTO", "GDBT", GRUPO_BT, "APBT", "APMT", "DIST", "DIT", "RABT", "RAMT"];
/**
 * Color fijo por tarifa en todo el tablero (no cambia con filtros ni con el tema).
 * Primero se usa el color que la tarifa ya tiene en el mapa (TARIFA_COLORS); si no lo tiene, uno de FIJOS;
 * si la tarifa es nueva, uno de la paleta elegido por su nombre (siempre el mismo para el mismo nombre).
 */
const COLOR_MAPA = new Map(Object.entries(TARIFA_COLORS as Record<string, string>).map(([k, c]) => [normTarifa(k), c]));
const FIJOS: Record<string, string> = {
  GDMTH: "#c0284e", GDMTO: "#bc955c", GDBT: "#6f8fa6", [GRUPO_BT]: "#3f9a7f", APBT: "#8a6bb0", APMT: "#d07a3a",
  DIST: "#9c6b4a", DIT: "#5c7a3a", RABT: "#4f86c6", RAMT: "#c9a227", "Sin tarifa": "#9a9da2"
};
/** Paletas para zonas y zonas de carga: distintas a las de tarifa para no confundirlas */
const PAL_ZONA = ["#1f6f8b", "#c26d2c", "#6a4c93", "#2e8b57", "#b8336a", "#8c7a2b", "#3d5a80", "#a0522d", "#5f7f3f", "#7a4e7a", "#2a9d8f", "#d1495b"];
const PAL_ZC = ["#264653", "#e76f51", "#2a9d8f", "#9b5de5", "#f4a261", "#3a86ff", "#8d6a9f", "#588157", "#bc4749", "#6c757d", "#00a6a6", "#c9a227", "#5e548e", "#e07a5f"];
const GRIS = "#9a9da2";
/**
 * Colores sin repetir: los primeros salen de la paleta base y, cuando se acaban, se generan con el ángulo áureo
 * (cada tono nuevo queda lejos de los anteriores) alternando luminosidad para separar los vecinos.
 */
const colorUnico = (i: number, base: string[]) => {
  if (i < base.length) return base[i];
  const j = i - base.length, h = Math.round((j * 137.508 + 20) % 360), l = [40, 54, 32][j % 3], sat = [58, 46, 52][Math.floor(j / 3) % 3];
  return `hsl(${h} ${sat}% ${l}%)`;
};
/** Asigna a cada nombre de la lista un color distinto (orden alfabético estable: no cambia con los filtros) */
const asignar = (nombres: Iterable<string>, base: string[], fijos: Record<string, string> = {}) => {
  const m = new Map<string, string>(Object.entries(fijos)); let i = 0;
  for (const n2 of [...new Set(nombres)].filter((x) => !m.has(x)).sort((a, b) => a.localeCompare(b, "es"))) m.set(n2, colorUnico(i++, base));
  return m;
};
const porNombre = (t: string, pal: string[]) => { let h = 0; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return pal[h % pal.length]; };
/** Paleta para dependencias (color fijo por nombre) */
const PAL_DEP = ["#4e79a7", "#f28e2b", "#59a14f", "#b07aa1", "#9c755f", "#76b7b2", "#edc948", "#e15759", "#ff9da7", "#8cd17d", "#86bcb6", "#d37295", "#a0cbe8", "#bab0ac"];
const PALETA_EXTRA = ["#7d2e46", "#2f6f8f", "#a1683a", "#5b8c5a", "#b05f87", "#6b6f2f", "#3d5a80", "#c26d5c"];
const colorTar = (t: string): string => {
  const c = COLOR_MAPA.get(t === GRUPO_BT ? "PDBT" : t) ?? FIJOS[t];
  if (c) return c;
  let h = 0; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETA_EXTRA[h % PALETA_EXTRA.length];
};
const ordTar = (a: string, b: string) => { const x = ORDEN_TAR.indexOf(a), y = ORDEN_TAR.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || a.localeCompare(b); };
type Theme = "light" | "dark";
const initialTheme = (): Theme => {
  try { const t = localStorage.getItem("tema"); if (t === "light" || t === "dark") return t; } catch { /* sin storage */ }
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

type Num = (r: Row) => number;
const tot: Num = (r) => r.total, kwh: Num = (r) => r.kwh;
const sum = (a: Row[], f: Num) => { let s = 0; for (const r of a) s += f(r); return s; };
/** Demanda máxima válida (descarta PDBT > 25 kW) */
const maxKw = (a: Row[]) => { let m = 0; for (const r of a) if (r.kwOk && r.kw > m) m = r.kw; return m; };
const by = (R: Row[], f: (r: Row) => string) => {
  const m = new Map<string, Row[]>();
  for (const r of R) { const k = f(r), l = m.get(k); if (l) l.push(r); else m.set(k, [r]); }
  return m;
};
const keys = (m: Map<string, unknown>) => [...m.keys()].sort();
/**
 * $/kWh sin IVA, la misma fórmula del mapa: Σ subtotal ÷ Σ kWh de los meses que tienen precio_sin_iva.
 * Los meses sin precio (consumo mínimo, atípico, refacturación, lectura estimada…) no entran.
 */
const conPrecio = (r: Row) => Number.isFinite(r.psi) && Number.isFinite(r.sub) && r.kwh > 0;
const precioDe = (a: Row[]) => { let s = 0, q = 0; for (const r of a) if (conPrecio(r)) { s += r.sub; q += r.kwh; } return q ? s / q : null; };
const unit = (a: Row[]) => precioDe(a) ?? 0;
const distinct = (a: Row[], f: (r: Row) => string | number) => new Set(a.map(f)).size;
/** Recibos = RPU distintos (cada fila es un mes del historial de un recibo) */
const nRec = (a: Row[]) => distinct(a, (r) => r.rpu);
/** Agrega los periodos de cada RPU en una fila por recibo */
const porRecibo = (a: Row[]) => [...by(a, (r) => r.rpu)].map(([rpu, x]) => {
  const pers = x.map((r) => r.per).sort();
  return { rpu, r: x[0], n: x.length, desde: pers[0], hasta: pers[pers.length - 1], kwh: sum(x, kwh), kwMax: Math.max(0, ...x.map((r) => r.kw)),
    total: sum(x, tot), cfe: x.some((r) => r.src === "cfe"), exc: x.filter((r) => r.kw > PDBT_MAX_KW).length };
});
const XT = { ticks: { maxTicksLimit: 12 } };

/* ── Demanda: es el tamaño de cada inmueble (kW), no algo que se acumule con el tiempo ── */
/** Rangos de tamaño para agrupar inmuebles por su demanda máxima */
const RANGOS_KW = [10, 25, 50, 100, 200, 500];
const ETQ_RANGO = ["Hasta 10 kW", "10 a 25 kW", "25 a 50 kW", "50 a 100 kW", "100 a 200 kW", "200 a 500 kW", "Más de 500 kW"];
const rangoKw = (kw: number) => { let i = 0; while (i < RANGOS_KW.length && kw > RANGOS_KW[i]) i++; return i; };
const mediana = (v: number[]) => { if (!v.length) return 0; const a = [...v].sort((x, y) => x - y), k = a.length >> 1; return a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2; };
/**
 * Rango de demanda que contempla cada tarifa de CFE: PDBT hasta 25 kW; GDBT más de 25 kW (baja tensión);
 * GDMTO menos de 100 kW y GDMTH 100 kW o más (media tensión). Domésticas: el tope supuesto de LIMITE_DOMESTICA_KW.
 */
const RANGO_TAR: Record<string, [number, number]> = { PDBT: [0, PDBT_MAX_KW], GDBT: [PDBT_MAX_KW, Infinity], GDMTO: [0, 100], GDMTH: [100, Infinity] };
const rangoTarifa = (t: string): [number, number] | null => RANGO_TAR[t] ?? (esDomestica(t) ? [0, LIMITE_DOMESTICA_KW] : null);
const txtRango = (g: [number, number]) => (g[1] === Infinity ? `más de ${N(g[0])} kW` : g[0] > 0 ? `${N(g[0])} a ${N(g[1])} kW` : `hasta ${N(g[1])} kW`);
/** Cómo queda la demanda máxima de un inmueble frente a su referencia (contratada si existe; si no, el rango de su tarifa) */
type Estado = "arriba" | "cerca" | "bien" | "holgada" | "sinref";
const ETQ_ESTADO: Record<"contr" | "tarifa", Record<Estado, string>> = {
  contr: { arriba: "Arriba de la contratada", cerca: "Cerca de la contratada (80–100 %)", bien: "Uso adecuado (50–80 %)", holgada: "Contratada de más (menos de 50 %)", sinref: "Sin demanda contratada" },
  tarifa: { arriba: "Arriba del rango de su tarifa", cerca: "Cerca del tope de su tarifa (80–100 %)", bien: "Dentro del rango de su tarifa", holgada: "Abajo del rango de su tarifa", sinref: "Tarifa sin rango de referencia" }
};
const COLOR_ESTADO: Record<Estado, string> = { arriba: "#c0284e", cerca: "#d08c2e", bien: "#3f9a7f", holgada: "#4f86c6", sinref: "#9a9da2" };
/** Demanda máxima de un inmueble (RPU) en el periodo: su mes más alto, medido y validado, o estimado si no mide demanda */
interface Dem { rpu: string; r: Row; kw: number; medida: boolean; contr: number; ref: number; refTxt: string; uso: number; estado: Estado; tipoRef: "contr" | "tarifa" }
const demandas = (a: Row[]): Dem[] => [...by(a.filter((r) => r.kwEst > 0), (r) => r.rpu)].map(([rpu, x]) => {
  const r = x.reduce((b, y) => (y.kwEst > b.kwEst ? y : b), x[0]), kw = r.kwEst, contr = r.contratada;
  if (Number.isFinite(contr) && contr > 0) {
    const uso = kw / contr;
    return { rpu, r, kw, medida: r.kwSrc === "medida", contr, ref: contr, refTxt: `${KW(contr)} contratados`, uso, tipoRef: "contr", estado: uso > 1 ? "arriba" : uso >= 0.8 ? "cerca" : uso >= 0.5 ? "bien" : "holgada" } as Dem;
  }
  const g = rangoTarifa(r.tarCFE);
  const estado: Estado = !g ? "sinref" : kw > g[1] ? "arriba" : g[1] !== Infinity && kw >= 0.8 * g[1] ? "cerca" : kw < g[0] ? "holgada" : "bien";
  return { rpu, r, kw, medida: r.kwSrc === "medida", contr: NaN, ref: g && g[1] !== Infinity ? g[1] : NaN, refTxt: g ? `${r.tarCFE}: ${txtRango(g)}` : "—",
    uso: g && g[1] !== Infinity ? kw / g[1] : NaN, tipoRef: "tarifa", estado } as Dem;
});
const MES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Consumo (línea) al frente y costo (barras) atrás: en Chart.js el dataset con menor «order» se dibuja encima */
/** Eje de dinero y de kWh: marcas compactas ($250 k, $1.2 M); el valor exacto va en el tooltip */
const EJE_PESOS = { ticks: { callback: (x: any) => "$" + compacto(Number(x)) } };
const EJE_KWH = { ticks: { callback: (x: any) => compacto(Number(x)) } };
/** Formato exacto del tooltip según el campo «fmt» del dataset */
const fmtValor = (ds: any, v: number) =>
  ds?.fmt === "pesos" ? P(v) : ds?.fmt === "kwh" ? N(v) + " kWh" : ds?.fmt === "kw" ? KW(v) : ds?.fmt === "pkwh" ? P(v) + " /kWh" : v.toLocaleString("es-MX", { maximumFractionDigits: 2 });
/** Costo en pesos (barras, atrás) y consumo en kWh (línea, al frente) */
const barLine = (labels: string[], costo: number[], kwhs: number[], c: string[]): Cfg => ({
  type: "bar",
  data: { labels, datasets: [
    { type: "line", label: "Consumo (kWh)", fmt: "kwh", data: kwhs, borderColor: c[1], backgroundColor: c[1], borderWidth: 2.5, pointRadius: 2, tension: 0.3, yAxisID: "y2", order: 1 },
    { type: "bar", label: "Costo ($)", fmt: "pesos", data: costo, backgroundColor: c[0], yAxisID: "y", order: 2 }] },
  options: { interaction: { mode: "index", intersect: false }, scales: { x: XT, y: { ...EJE_PESOS, title: { display: true, text: "Costo ($)" } },
    y2: { ...EJE_KWH, position: "right", grid: { display: false }, title: { display: true, text: "Consumo (kWh)" } } } }
});
/** Dona de costo; con colorDe, cada etiqueta conserva su color fijo (tarifas) */
const dona = (m: Map<string, Row[]>, c: string[] | ((k: string) => string), card: string): Cfg => ({
  type: "doughnut",
  data: { labels: [...m.keys()], datasets: [{ data: [...m.values()].map((a) => sum(a, tot)), backgroundColor: typeof c === "function" ? [...m.keys()].map(c) : c, borderColor: card }] },
  options: { plugins: { tooltip: { callbacks: { label: (x: any) => x.label + ": " + M(x.raw) } } } }
});

/** Hook reactivo para detectar pantallas móviles (<= 600px) */
function useEsMovil() {
  const [movil, setMovil] = useState(() =>
    typeof matchMedia === "function" ? matchMedia("(max-width: 600px)").matches : false
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(max-width: 600px)");
    const onChange = (e: MediaQueryListEvent) => setMovil(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return movil;
}

/** Invierte gráficos de barras verticales a horizontales en móvil para mejorar legibilidad */
function adaptarMovil(cfg: Cfg, esMovil: boolean): Cfg {
  if (!esMovil || cfg.type !== "bar" || cfg.options?.indexAxis === "y") return cfg;
  const sc = cfg.options?.scales ?? {};
  const nuevoSc: Record<string, any> = {};
  if (sc.y) nuevoSc.x = { ...sc.y, position: "bottom" };
  if (sc.x) nuevoSc.y = { ...sc.x, ticks: { ...(sc.x.ticks ?? {}), maxTicksLimit: undefined, autoSkip: false } };
  if (sc.y2) nuevoSc.x2 = { ...sc.y2, position: "top" };

  const datasets = cfg.data.datasets.map((ds: any) => {
    const copia = { ...ds };
    if (copia.yAxisID === "y2") { delete copia.yAxisID; copia.xAxisID = "x2"; }
    else if (copia.yAxisID === "y") { delete copia.yAxisID; copia.xAxisID = "x"; }
    return copia;
  });

  return {
    ...cfg,
    data: { ...cfg.data, datasets },
    options: { ...(cfg.options ?? {}), indexAxis: "y", scales: nuevoSc }
  };
}

function ChartCanvas({ config, theme, tall, alto }: { config: Cfg; theme: Theme; tall?: boolean; alto?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const esMovil = useEsMovil();
  const cfgFinal = useMemo(() => adaptarMovil(config, esMovil), [config, esMovil]);

  useEffect(() => {
    const pal = PAL[theme];
    Chart.defaults.color = pal.mut; Chart.defaults.borderColor = pal.bd;
    Chart.defaults.font.family = '"IBM Plex Sans",system-ui,sans-serif';
    const o = cfgFinal.options ?? {}, tt = o.plugins?.tooltip ?? {};
    const label = tt.callbacks?.label ?? ((y: any) => `${y.dataset.label ?? y.label}: ${fmtValor(y.dataset, Number(y.raw))}`);
    const ch = new Chart(ref.current!, { ...cfgFinal, options: { responsive: true, maintainAspectRatio: false, ...o,
      plugins: { ...(o.plugins ?? {}), tooltip: { ...tt, callbacks: { ...(tt.callbacks ?? {}), label } } } } });
    return () => ch.destroy();
  }, [cfgFinal, theme]);

  // Si se volvió horizontal en móvil, calculamos un alto cómodo según el número de etiquetas
  const esHorizontalMovil = esMovil && config.type === "bar" && config.options?.indexAxis !== "y";
  const altoMovil = esHorizontalMovil ? Math.max(260, (config.data.labels?.length ?? 1) * 26 + 70) : undefined;
  const estilo = altoMovil ? { height: altoMovil } : alto ? { height: alto } : tall ? { height: 340 } : undefined;

  return <div className="d-ch" style={estilo}><canvas ref={ref} /></div>;
}

/* ── Datos extremos: modos de visualización por gráfica ── */
type Modo = "normal" | "log" | "pct" | "sep" | "clip";
const ETQ_MODO: Record<Modo, string> = { normal: "Lineal", log: "Escala log", pct: "100 %", sep: "Separado", clip: "Recortar extremos" };
const AYUDA_MODO: Record<Modo, string> = {
  normal: "Valores tal cual, escala lineal",
  log: "Escala logarítmica: los valores grandes y pequeños se ven a la vez",
  pct: "Cada barra suma 100 %: muestra la participación de cada grupo",
  sep: "Barras lado a lado (sin apilar) en escala logarítmica: cada grupo se ve aunque sea pequeño",
  clip: "El eje se corta arriba de los valores normales: los picos aislados (más de 3 veces la mediana) no aplastan al resto; el valor real sigue en el tooltip"
};
const cuantilV = (v: number[], q: number) => { const a = v.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return 0; const p = (a.length - 1) * q, i = Math.floor(p); return a[i] + ((a[Math.min(i + 1, a.length - 1)] ?? a[i]) - a[i]) * (p - i); };
/** Tope del eje sin picos aislados: el mayor valor que no pasa de 3 × la mediana, con 15 % de aire */
const topeSinPicos = (v: number[]) => { const pos = v.filter((x) => Number.isFinite(x) && x > 0), med = cuantilV(pos, 0.5); const ok = pos.filter((x) => x <= 3 * med); return ok.length ? Math.max(...ok) * 1.15 : 0; };
const compacto = (x: number) => x.toLocaleString("es-MX", { notation: "compact", maximumFractionDigits: 1 });
/** Marcas de eje log: solo 1, 2 y 5 de cada potencia de 10 */
const ticksLog = { callback: (x: any) => { const v = Number(x); if (!(v > 0)) return ""; const f = v / 10 ** Math.floor(Math.log10(v)); return [1, 2, 5].includes(Math.round(f)) ? compacto(v) : ""; } };
const esLinea = (ds: any, cfg: Cfg) => (ds.type ?? cfg.type) === "line";
const ejeValor = (cfg: Cfg) => (cfg.options?.indexAxis === "y" ? "x" : "y");
/** Datasets dibujados sobre el eje de valores principal (en gráficas costo/consumo, la línea va en y2) */
const delEje = (ds: any, cfg: Cfg) => (ds.yAxisID ?? ds.xAxisID ?? ejeValor(cfg)) === ejeValor(cfg);
const valoresBarra = (cfg: Cfg) => cfg.data.datasets.filter((ds: any) => !esLinea(ds, cfg) && delEje(ds, cfg)).flatMap((ds: any) => ds.data.map(Number)).filter((x: number) => x > 0);

/**
 * Modo inicial de cada gráfica:
 *  · Barras apiladas (series de tiempo): siempre «Normal». «100 %» y «Separado» quedan a la mano, pero apilado se lee mejor.
 *  · Rankings y comparativos (con «Escala log»): log si la barra más chica mide menos del 3 % de la más grande,
 *    porque a ese tamaño ya casi no se ve.
 *  · Series con «Recortar extremos»: se recorta si hay un pico de más de 3 veces la mediana.
 */
const UMBRAL_LOG = 0.03;
function modoInicial(cfg: Cfg, modos: Modo[]): Modo {
  const v = valoresBarra(cfg), todos = cfg.data.datasets.filter((ds: any) => delEje(ds, cfg)).flatMap((ds: any) => ds.data.map(Number)).filter((x: number) => Number.isFinite(x) && x > 0);
  if (modos.includes("log") && v.length > 1 && Math.min(...v) / Math.max(...v) < UMBRAL_LOG) return "log";
  if (modos.includes("clip") && todos.length > 4 && Math.max(...todos) > 3 * cuantilV(todos, 0.5)) return "clip";
  return "normal";
}

/** Devuelve una copia de la configuración con el modo aplicado (no toca la original) */
function aplicarModo(cfg: Cfg, modo: Modo): Cfg {
  if (modo === "normal") return cfg;
  const ax = ejeValor(cfg), sc = { ...(cfg.options?.scales ?? {}) }, plugins = { ...(cfg.options?.plugins ?? {}) };
  let datasets = cfg.data.datasets.map((ds: any) => ({ ...ds, data: [...ds.data] }));
  const logEje = (k: string) => {
    const previo = sc[k]?.ticks?.callback;
    sc[k] = { ...(sc[k] ?? {}), type: "logarithmic", ticks: { ...(sc[k]?.ticks ?? {}), callback: (x: any, i: number, t: any) => { const e = ticksLog.callback(x); return e && previo ? previo(x, i, t) : e; } } };
  };
  const sinCeros = (ds: any) => ({ ...ds, data: ds.data.map((x: any) => (Number(x) > 0 ? x : null)) });
  if (modo === "log") {
    datasets = datasets.map((ds: any) => (esLinea(ds, cfg) || !delEje(ds, cfg) ? ds : sinCeros(ds)));
    logEje(ax);
  } else if (modo === "sep") {
    datasets = datasets.map((ds: any) => sinCeros({ ...ds, stack: undefined }));
    for (const k of Object.keys(sc)) sc[k] = { ...sc[k], stacked: false };
    logEje(ax);
  } else if (modo === "pct") {
    const barras = datasets.filter((ds: any) => !esLinea(ds, cfg)), n = cfg.data.labels.length;
    const tot = Array.from({ length: n }, (_, i) => barras.reduce((a: number, ds: any) => a + (Number(ds.data[i]) || 0), 0));
    datasets = barras.map((ds: any) => ({ ...ds, orig: ds.data, data: ds.data.map((x: any, i: number) => (tot[i] ? ((Number(x) || 0) / tot[i]) * 100 : 0)) }));
    sc[ax] = { ...(sc[ax] ?? {}), stacked: true, max: 100, title: { display: true, text: "% del total" } };
    plugins.tooltip = { ...(plugins.tooltip ?? {}), callbacks: { label: (y: any) => `${y.dataset.label}: ${Number(y.raw).toFixed(1)} % (${fmtValor(y.dataset, Number(y.dataset.orig[y.dataIndex]) || 0)})`, footer: () => "" } };
  } else if (modo === "clip") {
    const v = datasets.filter((ds: any) => delEje(ds, cfg)).flatMap((ds: any) => ds.data.map(Number)).filter((x: number) => Number.isFinite(x));
    const tope = topeSinPicos(v);
    if (tope > 0 && tope < Math.max(...v)) sc[ax] = { ...(sc[ax] ?? {}), max: Number(tope.toPrecision(2)), title: { display: true, text: (sc[ax]?.title?.text ?? "") + " · picos recortados" } };
  }
  return { ...cfg, data: { ...cfg.data, datasets }, options: { ...(cfg.options ?? {}), scales: sc, plugins } };
}

/** Gráfica con selector de modo; arranca en el modo que mejor muestra los datos */
function Grafica({ config, theme, tall, alto, modos }: { config: Cfg; theme: Theme; tall?: boolean; alto?: number; modos?: Modo[] }) {
  const [modo, setModo] = useState<Modo | null>(null);
  const actual: Modo = modo ?? (modos?.length ? modoInicial(config, modos) : "normal");
  const cfg = useMemo(() => aplicarModo(config, actual), [config, actual]);
  return <>
    {modos && modos.length > 0 && <div className="d-seg" role="group" aria-label="Forma de ver la gráfica">
      {(["normal", ...modos] as Modo[]).map((m) => <button key={m} type="button" className={m === actual ? "on" : ""} aria-pressed={m === actual} title={AYUDA_MODO[m]} onClick={() => setModo(m)}>{ETQ_MODO[m]}</button>)}
    </div>}
    <ChartCanvas config={cfg} theme={theme} tall={tall} alto={alto} />
  </>;
}

/** Barras horizontales ordenadas de mayor a menor, con % del total: sustituyen a las donas (los segmentos chicos se pierden) */
const barrasH = (pares: [string, number][], colorDe: (k: string) => string, fmt: (x: number) => string, etiqueta: string, eje: any = {}): Cfg => {
  const a = pares.filter((x) => x[1] > 0).sort((x, y) => y[1] - x[1]), tot = a.reduce((s2, x) => s2 + x[1], 0);
  return { type: "bar", data: { labels: a.map((x) => x[0]), datasets: [{ label: etiqueta, data: a.map((x) => x[1]), backgroundColor: a.map((x) => colorDe(x[0])) }] },
    options: { indexAxis: "y", scales: { x: eje }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (y: any) => `${fmt(Number(y.raw))} (${PCT(Number(y.raw), tot)})` } } } } };
};

/**
 * Ranking largo en un solo color: la intensidad sigue al valor (más oscuro = más gasto, escala log para que los chicos
 * no desaparezcan). Quita el ruido de 40+ colores distintos y se lee de un vistazo dónde se concentra el gasto.
 */
const escalaUnColor = (cfg: Cfg, color: string): Cfg => {
  const ds = cfg.data.datasets[0], v = (ds.data as number[]).filter((x) => x > 0);
  const lo = Math.log(Math.min(...v)), hi = Math.log(Math.max(...v));
  const hex = color.replace("#", ""), [r, g2, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  ds.backgroundColor = (ds.data as number[]).map((x, i) => String(cfg.data.labels[i]).startsWith("Otras (") ? GRIS
    : `rgba(${r}, ${g2}, ${b}, ${(0.28 + 0.72 * (hi > lo ? (Math.log(x) - lo) / (hi - lo) : 1)).toFixed(2)})`);
  ds.borderColor = color; ds.borderWidth = 0;
  return cfg;
};

/** Burbuja «i Consideraciones» que abre una ventana con la explicación; se cierra con ×, Esc o clic fuera */
function InfoPop({ titulo, children, etiqueta = "Consideraciones" }: { titulo: string; children: any; etiqueta?: string }) {
  const [abierto, setAbierto] = useState(false);
  const cerrar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!abierto) return;
    cerrar.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [abierto]);
  return <>
    <button type="button" className="d-info" onClick={() => setAbierto(true)} aria-haspopup="dialog"><span aria-hidden="true">i</span>{etiqueta}</button>
    {abierto && <div className="d-pop-fondo" onClick={() => setAbierto(false)}>
      <div className="d-pop" role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()}>
        <div className="d-pop-cab"><h2>{titulo}</h2><button ref={cerrar} type="button" className="d-pop-x" onClick={() => setAbierto(false)} aria-label="Cerrar">×</button></div>
        <div className="d-txt">{children}</div>
      </div>
    </div>}
  </>;
}
/** Encabezado de tarjeta con botón «Informe» que explica cómo se calcula la gráfica */
const Cab = ({ t, info }: { t: any; info: any }) => (
  <div className="d-hrow"><h2>{t}</h2><InfoPop titulo={typeof t === "string" ? "Informe: " + t : "Informe de la gráfica"} etiqueta="Informe">{info}</InfoPop></div>
);
const Kpis = ({ items, id }: { items: [string, string | number][]; id?: string }) => (
  <section className="d-kpis" id={id}>{items.map(([a, b]) => <div className="d-kpi" key={a}><span>{a}</span><b>{b}</b></div>)}</section>
);
const Falta = ({ que, cmd }: { que: string; cmd: string }) => (
  <div className="d-card w12"><h2>Sin {que}</h2><p className="d-mut">Genera el archivo con <code>{cmd}</code> y vuelve a cargar la página.</p></div>
);

/** Origen del costo de cada mes */
const ORIGEN_COSTO: Record<Row["src"], string> = { subtotal: "Subtotal del recibo", cfe: "Tabla CFE", none: "Sin costo" };
/** Color fijo por división tarifaria de CFE */
const COLOR_DIV: Record<string, string> = { "Golfo Norte": "#1f6f8b", "Golfo Centro": "#c26d2c" };
/** Dimensiones para agrupar gráficas */
type Dim = "tarifa" | "división" | "dependencia" | "municipio" | "zona" | "zona de carga" | "inmueble";
const DIMS: Dim[] = ["tarifa", "división", "dependencia", "municipio", "zona", "zona de carga", "inmueble"];
/* ── Filtros relacionados entre sí ── */
type Filtros = { dep: string; tar: string; div: string; mun: string; nodo: string };
type CampoF = keyof Filtros;
const CAMPOS_F: CampoF[] = ["dep", "tar", "div", "mun", "nodo"];
const NOMBRE_F: Record<CampoF, string> = { dep: "dependencia", tar: "tarifa", div: "división", mun: "municipio", nodo: "zona de carga" };
const campoF = (r: Row, k: CampoF) => (k === "dep" ? r.dep : k === "tar" ? r.tar : k === "div" ? r.division : k === "mun" ? r.mun : r.nodo);
const SIN_FILTROS: Filtros = { dep: "", tar: "", div: "", mun: "", nodo: "" };
/** ¿El recibo pasa todos los filtros, salvo el indicado? (para calcular las opciones de ese filtro) */
const pasaF = (r: Row, f: Filtros, salvo?: CampoF) => CAMPOS_F.every((k) => k === salvo || !f[k] || campoF(r, k) === f[k]);
const TABS: [Tab, string][] = [["pg", "General"], ["co", "Consumo"], ["dm", "Demanda"], ["pc", "Zonas"], ["np", "Catálogo NodosP"]];
const GK_DIM: Record<GK, Dim> = { tar: "tarifa", div: "división", zona: "zona", nodo: "zona de carga", dep: "dependencia", mun: "municipio" };
const GKS: [GK, string][] = [["tar", "Tarifa"], ["div", "División CFE"], ["zona", "Zona"], ["nodo", "Zona de carga (NodoP)"], ["dep", "Dependencia"], ["mun", "Municipio"]];

export function Dashboard({ onBack }: { onBack: () => void }) {
  const model = useStore((s) => s.model);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [tab, setTab] = useState<Tab>("pg");
  const [f, setF] = useState<Filtros>(SIN_FILTROS);
  const [avisoF, setAvisoF] = useState("");
  const [zonaSel, setZonaSel] = useState("");
  const [gk, setGk] = useState<GK>("tar");
  const [tsel, setTsel] = useState("");   // demanda máxima individual: "" = general
  const [q, setQ] = useState(""); const [zc, setZc] = useState("");
  const [of, setOf] = useState<Oficial | null>(null);
  const zonaRef = useRef<HTMLSelectElement>(null);
  const tabsRef = useRef<HTMLElement>(null);

  useEffect(() => { let vivo = true; cargarOficial().then((o) => { if (vivo) setOf(o); }); return () => { vivo = false; }; }, []);

  const base = useMemo(() => (model ? buildRows(model) : []), [model]);
  const rows = useMemo(() => aplicarOficial(base, of), [base, of]);
  /**
   * Colores fijos por zona, municipio y zona de carga (no cambian con filtros ni pestañas):
   *  · zona: por el orden de la zona en el modelo (id)
   *  · municipio: el color de su zona, para leer juntos los municipios de una misma zona
   *  · zona de carga: por su orden en el catálogo completo de NodosP de Tamaulipas
   */
  const colores = useMemo(() => {
    const zonas = [...(model?.zones ?? [])].sort((a, b) => a.id - b.id).map((z2) => z2.nombre);
    const zcs = [...new Set((of?.nodos?.nodos ?? []).map((x) => x.zonaCarga).filter(Boolean))].sort();
    const munZona = new Map<string, string>();
    for (const r of rows) if (!munZona.has(r.mun)) munZona.set(r.mun, r.zona);
    const cZona = new Map(zonas.map((z2, i) => [z2, colorUnico(i, PAL_ZONA)])), cZc = new Map(zcs.map((x, i) => [x, colorUnico(i, PAL_ZC)]));
    const cDep = asignar(rows.map((r) => r.dep), PAL_DEP, { "Sin dependencia": GRIS });
    const zona = (n2: string) => n2 === "Sin zona" ? GRIS : cZona.get(n2) ?? porNombre(n2, PAL_ZONA);
    const zc = (n2: string) => n2 === "Sin nodo" ? GRIS : cZc.get(n2) ?? porNombre(n2, PAL_ZC);
    const dep = (n2: string) => cDep.get(n2) ?? porNombre(n2, PAL_DEP);
    // Cada municipio con su propio color (antes heredaba el de su zona y se repetía entre municipios de la misma zona)
    const cMun = asignar(rows.map((r) => r.mun), [...PAL_ZONA, ...PAL_DEP], { "Sin dato": GRIS, "Sin municipio": GRIS });
    const mun = (n2: string) => cMun.get(n2) ?? zona(munZona.get(n2) ?? "Sin zona");
    return { zona, zc, mun, dep, zonas: zonas.filter((x) => rows.some((r) => r.zona === x)) };
  }, [model, of, rows]);
  /** Color del grupo según el agrupamiento elegido en Demanda */
  const colorGrupo = (k: string) => (gkEf === "tar" ? colorTar(k) : gkEf === "div" ? (COLOR_DIV[k] ?? GRIS) : gkEf === "zona" ? colores.zona(k) : gkEf === "nodo" ? colores.zc(k) : gkEf === "mun" ? colores.mun(k) : gkEf === "dep" ? colores.dep(k) : "");
  const Punto = ({ c }: { c: string }) => <span className="d-dot" style={{ background: c }} aria-hidden="true" />;
  /**
   * Opciones de cada filtro según los otros filtros: solo aparecen las combinaciones que existen
   * (municipios de la zona de carga elegida, tarifas que hay en el municipio, dependencias presentes, etc.).
   */
  const opts = useMemo(() => {
    const faceta = (k: CampoF) => {
      const m = new Map<string, Set<string>>();
      for (const r of rows) if (pasaF(r, f, k)) { const v = campoF(r, k); const s2 = m.get(v); if (s2) s2.add(r.rpu); else m.set(v, new Set([r.rpu])); }
      const l = [...m].map(([v, s2]) => [v, s2.size] as [string, number]);
      return k === "tar" ? l.sort((a, b) => ordTar(a[0], b[0])) : l.sort((a, b) => a[0].localeCompare(b[0], "es"));
    };
    return { dep: faceta("dep"), tar: faceta("tar"), div: faceta("div"), mun: faceta("mun"), nodo: faceta("nodo") };
  }, [rows, f]);

  const R = useMemo(() => rows.filter((r) => pasaF(r, f)), [rows, f]);

  /*
   * Dimensiones con las que se agrupan las gráficas. Cuando un filtro deja una sola categoría (por ejemplo, un solo
   * municipio), la gráfica que agrupaba por esa dimensión cambia a la siguiente de su lista de preferencias que sí tenga
   * varias categorías. Entre gráficas del mismo dato (costo) no se repite la dimensión, para no mostrar lo mismo dos veces.
   */
  const dimF: Record<Dim, (r: Row) => string> = useMemo(() => ({
    tarifa: (r) => r.tar, "división": (r) => r.division, dependencia: (r) => r.dep, municipio: (r) => r.mun, zona: (r) => r.zona, "zona de carga": (r) => r.nodo,
    inmueble: (r) => `${model?.props[r.i]?.nombre ?? "Inmueble"} · RPU ${r.rpu}`
  }), [model]);
  const munDeInm = useMemo(() => { const m = new Map<string, string>(); for (const r of rows) m.set(`${model?.props[r.i]?.nombre ?? "Inmueble"} · RPU ${r.rpu}`, r.mun); return m; }, [rows, model]);
  const colorDim = (d: Dim, k: string): string =>
    k.startsWith("Otras (") ? GRIS : d === "tarifa" ? colorTar(k) : d === "división" ? (COLOR_DIV[k] ?? GRIS) : d === "dependencia" ? colores.dep(k) : d === "municipio" ? colores.mun(k)
      : d === "zona" ? colores.zona(k) : d === "zona de carga" ? colores.zc(k) : colores.mun(munDeInm.get(k) ?? "");
  const catsDe = (a: Row[]) => Object.fromEntries(DIMS.map((d) => [d, new Set(a.map(dimF[d])).size])) as Record<Dim, number>;
  /** Primera dimensión de la lista con más de una categoría (y que no esté ocupada por otra gráfica del mismo dato) */
  const elegir = (cats: Record<Dim, number>, pref: Dim[], usadas = new Set<Dim>()) => pref.find((d) => cats[d] > 1 && !usadas.has(d)) ?? null;
  /** Reparte dimensiones entre varias gráficas: primero cada una con su dimensión natural, luego las que falten */
  const repartir = (cats: Record<Dim, number>, tarjetas: [string, Dim[]][]) => {
    const out: Record<string, Dim | null> = {}, usadas = new Set<Dim>();
    for (const [k, p] of tarjetas) if (cats[p[0]] > 1) { out[k] = p[0]; usadas.add(p[0]); }
    for (const [k, p] of tarjetas) if (!(k in out)) { const d = elegir(cats, p, usadas); out[k] = d; if (d) usadas.add(d); }
    return out;
  };
  /** Ranking horizontal de un valor por dimensión: las top-1 mayores y el resto junto en «Otras» */
  const ranking = (a: Row[], d: Dim, val: (x: Row[]) => number, fmt: (x: number) => string, etiqueta: string, top = 15, eje: any = {}): Cfg => {
    let pares = [...by(a, dimF[d])].map(([k, x]) => [k, val(x)] as [string, number]).filter((x) => x[1] > 0).sort((x, y) => y[1] - x[1]);
    if (pares.length > top) { const resto = pares.slice(top - 1); pares = [...pares.slice(0, top - 1), [`Otras (${resto.length})`, resto.reduce((s2, x) => s2 + x[1], 0)]]; }
    return barrasH(pares, (k) => colorDim(d, k), fmt, etiqueta, eje);
  };
  /** Serie mensual apilada por dimensión (máx. 8 categorías + «Otras») */
  const apiladoMes = (a: Row[], d: Dim, mons: string[], valMes: (x: Row[]) => number, fmt: string, ejeY: any) => {
    const tot = [...by(a, dimF[d])].map(([k, x]) => [k, valMes(x)] as [string, number]).sort((x, y) => y[1] - x[1]);
    const orden = d === "tarifa" ? tot.map((x) => x[0]).sort(ordTar) : tot.map((x) => x[0]);
    const prin = orden.slice(0, tot.length > 8 ? 7 : 8), grupo = (r: Row) => (prin.includes(dimF[d](r)) ? dimF[d](r) : `Otras (${tot.length - prin.length})`);
    const cats = tot.length > 8 ? [...prin, `Otras (${tot.length - prin.length})`] : prin, gm = by(a, (r) => grupo(r) + "|" + r.per);
    return { type: "bar", data: { labels: mons, datasets: cats.map((k) => ({ label: k, fmt, stack: "s", backgroundColor: colorDim(d, k), data: mons.map((m) => valMes(gm.get(k + "|" + m) ?? [])) })) },
      options: { interaction: { mode: "index", intersect: false }, scales: { x: { stacked: true, ...XT }, y: { ...ejeY, stacked: true } } } } as Cfg;
  };

  /* ── General y zonas ── */
  const v = useMemo(() => {
    const c = PAL[theme].c;
    const pm = by(R, (r) => r.per), mons = keys(pm);
    const ta = by(R, (r) => r.tar), tm = by(R, (r) => r.tar + "|" + r.per);
    const ca = by(R, (r) => r.zona), cn = keys(ca);
    const top = porRecibo(R).sort((a, b) => b.total - a.total).slice(0, 10);
    const g = (m: Map<string, Row[]>, k: string) => m.get(k) ?? [];
    const tarsAll = [...ta.keys()].sort(ordTar), col = colorTar;
    /** $/kWh sin IVA de los meses con precio_sin_iva (Σ subtotal ÷ Σ kWh); sin estimaciones */
    const real = precioDe;
    const tarsReal = tarsAll.filter((t) => real(g(ta, t)) !== null);
    const cats = catsDe(R);

    // Demanda máxima de cada inmueble (su mes más alto); con eso se describe el tamaño de los inmuebles, sin sumar
    const dems = demandas(R);
    // Suma de las demandas máximas de cada mes (cada recibo aporta su pico del mes, ya validado o estimado)
    const sumKw = (a: Row[]) => a.reduce((s2, r) => s2 + (r.kwEst > 0 ? r.kwEst : 0), 0);
    const sumMes = mons.map((m) => sumKw(g(pm, m))), estMes = mons.map((m) => sumKw(g(pm, m).filter((r) => r.kwSrc === "estimada")));
    const iPico = sumMes.reduce((b, y, i) => (y > sumMes[b] ? i : b), 0);

    // Resumen anual: consumo y gasto sumados por año; demanda del año = la demanda máxima del inmueble más grande en ese año
    const anual = [...new Set(mons.map((k) => k.slice(0, 4)))].map((y) => {
      const ix = mons.filter((k) => k.startsWith(y)), a = R.filter((r) => r.per.startsWith(y)), dy = demandas(a);
      return { y, meses: ix.length, kwh: sum(a, kwh), gasto: sum(a, tot), dem: Math.max(0, ...dy.map((x) => x.kw)), tipica: mediana(dy.map((x) => x.kw)),
        // Mes con la mayor suma de demandas máximas (la misma suma de la gráfica «Suma de demandas máximas por mes»)
        ...ix.reduce((b, m) => { const t = g(pm, m).reduce((s2, r) => s2 + (r.kwEst > 0 ? r.kwEst : 0), 0); return t > b.picoKw ? { picoKw: t, picoMes: m } : b; }, { picoKw: 0, picoMes: "—" }) };
    });

    // Dimensiones de cada gráfica según los filtros
    const dimG = elegir(cats, ["tarifa", "zona", "dependencia", "municipio", "zona de carga"]);
    // Recibos por inmueble no aporta (cada inmueble tiene un recibo), por eso «inmueble» no está en esta lista
    const dimP = elegir(cats, ["tarifa", "dependencia", "municipio", "zona de carga"]);
    const costo = repartir(cats, [["c2", ["tarifa", "división", "zona de carga", "zona", "dependencia"]], ["c7", ["dependencia", "municipio", "tarifa", "zona de carga"]]]);
    /*
     * «Costo por municipio»: si el filtro deja un solo municipio (o la dimensión ya la usa otra gráfica), pasa a zona de carga;
     * si tampoco, se vuelve «Costo mensual por …» (tarifa, dependencia, zona): agrega el tiempo, que no tienen las otras gráficas de costo.
     * No se usa «inmueble»: repetiría la tabla «Recibos de mayor gasto».
     */
    const c6Rank = elegir(cats, ["municipio", "zona de carga"], new Set([costo.c2, costo.c7].filter(Boolean) as Dim[]));
    const c6Mes = c6Rank ? null : elegir(cats, ["tarifa", "dependencia", "zona", "zona de carga"]);
    const dimU = elegir(cats, ["tarifa", "división", "zona", "dependencia", "municipio"]);
    const dimZ = elegir(cats, ["zona", "municipio", "tarifa", "dependencia"]), dimZU = elegir(cats, ["zona", "municipio", "zona de carga", "tarifa"]);
    const gasto = (x: Row[]) => sum(x, tot);
    const real2 = (x: Row[]) => real(x) ?? 0;

    const charts: Record<string, Cfg | null> = {
      /*
       * Demanda por mes: suma de las demandas máximas del mes de todos los recibos, apilada por categoría.
       * GDMTH/GDMTO aportan su kW medido (después de corregir los casos extraños); PDBT y domésticas, el estimado por consumo.
       */
      cDM: dimG && (() => {
        const k = apiladoMes(R.filter((r) => r.kwEst > 0), dimG, mons, sumKw, "kw", { title: { display: true, text: "kW (suma de picos)" } });
        // Al pasar el cursor, además del dato de cada categoría, el total del mes en megawatts
        k.options.plugins = { ...(k.options.plugins ?? {}), tooltip: { callbacks: { footer: (it: any[]) => it.length ? `Total del mes: ${(sumMes[it[0].dataIndex] / 1000).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MW` : "" } } };
        return k;
      })(),
      // Tamaño de los inmuebles: cuántos inmuebles hay en cada rango de demanda máxima, apilados por categoría
      cG: dimG && (() => {
        const cuenta = new Map<string, number[]>();
        for (const x of dems) { const k = dimF[dimG](x.r), l = cuenta.get(k) ?? Array(ETQ_RANGO.length).fill(0); l[rangoKw(x.kw)]++; cuenta.set(k, l); }
        const orden = [...cuenta.keys()].sort(dimG === "tarifa" ? ordTar : (a, b) => cuenta.get(b)!.reduce((s2, n) => s2 + n, 0) - cuenta.get(a)!.reduce((s2, n) => s2 + n, 0));
        const prin = orden.slice(0, orden.length > 8 ? 7 : 8), resto = orden.slice(prin.length);
        const ds = prin.map((k) => ({ label: k, data: cuenta.get(k)! }));
        if (resto.length) ds.push({ label: `Otras (${resto.length})`, data: ETQ_RANGO.map((_, i) => resto.reduce((s2, k) => s2 + cuenta.get(k)![i], 0)) });
        return { type: "bar", data: { labels: ETQ_RANGO, datasets: ds.map((x) => ({ ...x, stack: "s", backgroundColor: colorDim(dimG, x.label) })) },
          options: { interaction: { mode: "index", intersect: false },
            plugins: { tooltip: { callbacks: { label: (y: any) => `${y.dataset.label}: ${N(y.raw ?? 0)} inmuebles`, footer: (it: any[]) => "Total: " + N(it.reduce((s2, y) => s2 + (y.raw ?? 0), 0)) + " inmuebles" } } },
            scales: { x: { stacked: true, title: { display: true, text: "Demanda máxima del inmueble" } }, y: { stacked: true, title: { display: true, text: "Inmuebles" } } } } } as Cfg;
      })(),
      cP: dimP && ranking(R, dimP, nRec, (x) => N(x) + " recibos", "Recibos (RPU)"),
      c1: barLine(mons, mons.map((k) => sum(g(pm, k), tot)), mons.map((k) => sum(g(pm, k), kwh)), c),
      c2: costo.c2 && ranking(R, costo.c2, gasto, P, "Costo", 15, EJE_PESOS),
      c3: dimU && { type: "line", data: { labels: mons, datasets: (() => {
        const grupos = [...by(R, dimF[dimU])].filter(([, x]) => real(x) !== null).sort((x, y) => sum(y[1], kwh) - sum(x[1], kwh)).slice(0, 8);
        const gm = by(R, (r) => dimF[dimU](r) + "|" + r.per);
        return grupos.map(([k]) => ({ label: k, fmt: "pkwh", borderColor: colorDim(dimU, k), backgroundColor: colorDim(dimU, k), pointRadius: 0, tension: 0.3, spanGaps: true, data: mons.map((m) => real(gm.get(k + "|" + m) ?? [])) }));
      })() }, options: { scales: { x: XT, y: { title: { display: true, text: "$/kWh" } } } } },
      c6: c6Rank ? (c6Rank === "municipio" ? escalaUnColor(ranking(R, c6Rank, gasto, P, "Costo", 50, EJE_PESOS), c[0]) : ranking(R, c6Rank, gasto, P, "Costo", 15, EJE_PESOS))
        : c6Mes && apiladoMes(R, c6Mes, mons, gasto, "pesos", { ...EJE_PESOS, title: { display: true, text: "Costo ($)" } }),
      c7: costo.c7 && ranking(R, costo.c7, gasto, P, "Costo", 10, EJE_PESOS),
      c8: dimZ && apiladoMes(R, dimZ, mons, gasto, "pesos", { ...EJE_PESOS, title: { display: true, text: "Costo ($)" } }),
      c9: dimZU && ranking(R, dimZU, real2, (x) => P(x) + " /kWh", "$/kWh", 15)
    };
    const altoDe = (k: string) => { const cfg = charts[k]; return Math.max(300, (cfg?.data.labels.length ?? 1) * 22 + 60); };
    const conCosto = R.filter((r) => r.src !== "none").length, kCosto = sum(R.filter((r) => r.src !== "none"), kwh);
    const orig = (["subtotal", "cfe", "none"] as Row["src"][]).map((k) => { const a = R.filter((r) => r.src === k); return { k, n: a.length, kwh: sum(a, kwh), g: sum(a, tot) }; });
    // Meses sin precio sin IVA, por motivo (precio_origen); su kWh sigue en el consumo y su subtotal, si existe, en el gasto
    const sinPrecio = [...by(R.filter((r) => !conPrecio(r) && (r.kwh > 0 || r.lecEst || Number.isFinite(r.sub))), (r) => r.origen)]
      .map(([k, a]) => ({ k, txt: MOTIVO_SIN_PRECIO[k] ?? k, n: a.length, kwh: sum(a, kwh), g: sum(a, tot) })).sort((a, b) => b.n - a.n);
    const lecEst = R.filter((r) => r.lecEst), consAt = R.filter((r) => r.consAt || r.kwhAt);
    // Recibos que cambiaron de tarifa dentro del periodo (la tarifa ahora viene de cada mes del historial)
    const cambioTar = [...by(R, (r) => r.rpu)].filter(([, a]) => new Set(a.map((r) => r.tarCFE)).size > 1).length;
    const zTop = [...ca].map(([k, a]) => [k, sum(a, tot)] as [string, number]).sort((a, b) => b[1] - a[1])[0];
    const dims = { cG: dimG, cP: dimP, c2: costo.c2, c3: dimU, c6: c6Rank ?? c6Mes, c6Mes: !c6Rank && !!c6Mes, c7: costo.c7, c8: dimZ, c9: dimZU };
    return { dims, cats, altoDe, recDim: dimP ?? "tarifa", recN: dimP ? cats[dimP] : 0, recAlto: altoDe("cP"), dems, demMax: Math.max(0, ...dems.map((x) => x.kw)), demTip: mediana(dems.map((x) => x.kw)), mesPico: mons[iPico] ?? "—", sumPico: sumMes[iPico] ?? 0, estPico: estMes[iPico] ?? 0, recPico: nRec(g(pm, mons[iPico] ?? "").filter((r) => r.kwEst > 0)), anual, T: sum(R, tot), K: sum(R, kwh),
      charts, ca, cn, top, conCosto, kCosto, orig, sinPrecio, lecEst, consAt, cambioTar, zTop, sinReal: tarsAll.filter((t) => !tarsReal.includes(t)), tarsAll, col };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [R, theme, colores, dimF, munDeInm]);

  /* ── Consumo: todo sale de R, así que sin filtros es el consumo general y con filtros solo el de los recibos que pasan ── */
  const co = useMemo(() => {
    const c = PAL[theme].c;
    const pm = by(R, (r) => r.per), mons = keys(pm), cats = v.cats, kwhMes = (x: Row[]) => sum(x, kwh);
    const ejeKwh = { ...EJE_KWH, title: { display: true, text: "Consumo (kWh)" } };
    const dimC = elegir(cats, ["tarifa", "zona", "dependencia", "municipio", "zona de carga"]);
    const dimR = elegir(cats, ["dependencia", "tarifa", "municipio", "zona de carga", "zona"], new Set(dimC ? [dimC] : []));
    const mensual: Cfg = dimC
      ? (() => { const k = apiladoMes(R, dimC, mons, kwhMes, "kwh", ejeKwh);
          k.options.plugins = { tooltip: { callbacks: { label: (y: any) => `${y.dataset.label}: ${N(y.raw ?? 0)} kWh`, footer: (it: any[]) => "Total: " + N(it.reduce((s2, y) => s2 + (y.raw ?? 0), 0)) + " kWh" } } }; return k; })()
      : { type: "bar", data: { labels: mons, datasets: [{ label: "Consumo (kWh)", fmt: "kwh", backgroundColor: c[0], data: mons.map((m) => kwhMes(pm.get(m) ?? [])) }] },
          options: { interaction: { mode: "index", intersect: false }, scales: { x: XT, y: ejeKwh } } };
    const ranking2 = dimR ? ranking(R, dimR, kwhMes, (x) => N(x) + " kWh", "Consumo (kWh)", 15, EJE_KWH) : null;
    // Año contra año: un mes del año en cada punto; los meses sin datos quedan vacíos
    const anios = v.anual.map((a) => a.y);
    const cmp: Cfg | null = anios.length > 1 ? { type: "line", data: { labels: MES_CORTO, datasets: anios.map((y, i) => ({ label: y, fmt: "kwh", borderColor: c[i % c.length], backgroundColor: c[i % c.length], borderWidth: 2.5, pointRadius: 3, tension: 0.3, spanGaps: false,
      data: MES_CORTO.map((_, m) => { const k = `${y}-${String(m + 1).padStart(2, "0")}`; return pm.has(k) ? kwhMes(pm.get(k) ?? []) : null; }) })) },
      options: { interaction: { mode: "index", intersect: false }, scales: { x: {}, y: ejeKwh } } } : null;
    // Consumo (barras) contra demanda general aproximada (línea) mes a mes; el factor de carga del mes va en el tooltip
    const kwhs = mons.map((k) => kwhMes(pm.get(k) ?? []));
    // Demanda típica del mes = mediana de la demanda de los inmuebles ese mes (no se suman: la demanda es el tamaño de cada uno)
    const dem = mons.map((k) => mediana((pm.get(k) ?? []).filter((r) => r.kwEst > 0).map((r) => r.kwEst)));
    // Factor de carga del mes, ponderado: Σ kWh / (horas · Σ kW) de los inmuebles con demanda ese mes
    const fcMes = mons.map((k) => { const a = (pm.get(k) ?? []).filter((r) => r.kwEst > 0 && !r.lecEst), [y, m] = k.split("-").map(Number), h = 24 * new Date(y, m, 0).getDate(), w = sum(a, (r) => r.kwEst); return w > 0 ? sum(a, kwh) / (h * w) : NaN; });
    const cd: Cfg = { type: "bar", data: { labels: mons, datasets: [
        { type: "line", label: "Demanda típica por inmueble", fmt: "kw", data: dem, borderColor: c[1], backgroundColor: c[1], borderWidth: 2.5, pointRadius: 2, tension: 0.3, yAxisID: "y2", order: 1 },
        { type: "bar", label: "Consumo", fmt: "kwh", data: kwhs, backgroundColor: c[0], yAxisID: "y", order: 2 }] },
      options: { interaction: { mode: "index", intersect: false },
        plugins: { tooltip: { callbacks: { label: (y: any) => `${y.dataset.label}: ${fmtValor(y.dataset, y.raw ?? 0)}`,
          footer: (it: any[]) => { const f = fcMes[it[0]?.dataIndex]; return Number.isFinite(f) ? `Factor de carga: ${(f * 100).toFixed(1)} %` : ""; } } } },
        scales: { x: XT, y: { ...EJE_KWH, title: { display: true, text: "Consumo (kWh)" } },
          y2: { ...EJE_KWH, position: "right", grid: { display: false }, title: { display: true, text: "Demanda típica (kW)" } } } } };
    const top = porRecibo(R).sort((a, b) => b.kwh - a.kwh).slice(0, 10);
    return { dimC, dimR, mensual, ranking2, cmp, cd, top, rpu: nRec(R) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [R, theme, colores, dimF, munDeInm, v]);

  /* Agrupaciones de la pestaña Demanda: solo las que tienen varias categorías con los filtros actuales */
  const gkOps = GKS.filter(([k]) => v.cats[GK_DIM[k]] > 1);
  const gkEf: GK = gkOps.some((x) => x[0] === gk) ? gk : (gkOps[0]?.[0] ?? gk);

  /* ── Demanda ── */
  const d = useMemo(() => {
    const c = PAL[theme].c, col = v.col;
    const am = by(R, (r) => r.per), ams = keys(am);
    // ¿La demanda máxima corresponde a la contratada (si existe) o al rango de su tarifa?
    const dems = v.dems, conContr = dems.filter((x) => x.tipoRef === "contr").length;
    const tipoRef: "contr" | "tarifa" = conContr >= dems.length / 2 && conContr > 0 ? "contr" : "tarifa";
    const ORDEN_EST: Estado[] = ["arriba", "cerca", "bien", "holgada", "sinref"];
    const cnt = ORDEN_EST.map((e) => [e, dems.filter((x) => x.estado === e)] as [Estado, Dem[]]).filter(([, a]) => a.length);
    const etqE = (x: Dem) => ETQ_ESTADO[x.tipoRef][x.estado];
    const cmpCfg: Cfg | null = dems.length ? { type: "bar", data: { labels: cnt.map(([e]) => ETQ_ESTADO[tipoRef][e]), datasets: [{ label: "Inmuebles", data: cnt.map(([, a]) => a.length), backgroundColor: cnt.map(([e]) => COLOR_ESTADO[e]) }] },
      options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (y: any) => `${N(y.raw)} inmuebles (${PCT(y.raw, dems.length)})` } } } } } : null;
    const revisar = dems.filter((x) => x.estado === "arriba" || x.estado === "cerca" || x.estado === "holgada").sort((a, b) => (ORDEN_EST.indexOf(a.estado) - ORDEN_EST.indexOf(b.estado)) || ((b.uso || 0) - (a.uso || 0)));
    const cmp = { cfg: cmpCfg, tipoRef, conContr, revisar, etqE, arriba: dems.filter((x) => x.estado === "arriba").length };

    // Demanda máxima individual: un RPU; medida si la trae, estimada si no
    const pool = (tsel ? R.filter((r) => r.tar === tsel) : R).filter((r) => r.kwEst > 0);
    const porR = [...by(pool, (r) => r.rpu)].map(([rpu, a]) => { const m = a.reduce((b, r) => (r.kwEst > b.kwEst ? r : b), a[0]); return { rpu, m, n: a.length, med: a.some((r) => r.kwSrc === "medida") }; })
      .sort((a, b) => b.m.kwEst - a.m.kwEst);
    const refDe = new Map(dems.map((x) => [x.rpu, x]));
    const indiv = { max: porR[0]?.m.kwEst ?? 0, pico: porR[0]?.m ?? null, prom: mediana(porR.map((x) => x.m.kwEst)), n: porR.length, refDe,
      medidos: porR.filter((x) => x.med).length, top: porR.slice(0, 10) };

    const D = R.filter((r) => TAR_DEMANDA.includes(r.tar) && r.kwOk);
    const gf: Record<GK, (r: Row) => string> = { tar: (r) => r.tar, div: (r) => r.division, zona: (r) => r.zona, nodo: (r) => r.nodo, dep: (r) => r.dep, mun: (r) => r.mun };
    // Por grupo no se suman demandas: se describe el tamaño típico (mediana) y el inmueble más grande
    const grupos = [...by(R.filter((r) => r.kwEst > 0), gf[gkEf])].map(([k, a]) => {
      const dg = demandas(a), horas = sum(a.filter((r) => r.kwSrc === "medida"), (r) => r.kw * 24 * r.dias);
      return { k, n: distinct(a, (r) => r.i), rec: nRec(a), kwMax: Math.max(0, ...dg.map((x) => x.kw)), tip: mediana(dg.map((x) => x.kw)),
        fuera: dg.filter((x) => x.estado === "arriba" || x.estado === "holgada").length,
        est: PCT(a.filter((r) => r.kwSrc === "estimada").length, a.length), fc: horas ? sum(a.filter((r) => r.kwSrc === "medida"), kwh) / horas : 0,
        cDem: sum(a, (r) => (r.partes ? r.partes.distribucion + r.partes.capacidad : 0)), tars: [...new Set(a.map((r) => r.tar))].sort(ordTar).join(", ") };
    }).sort((x, y) => y.kwMax - x.kwMax);
    const g15 = grupos.slice(0, 15);
    const colG = (k: string) => (gkEf === "tar" ? colorTar(k) : gkEf === "div" ? (COLOR_DIV[k] ?? GRIS) : gkEf === "zona" ? colores.zona(k) : gkEf === "nodo" ? colores.zc(k) : gkEf === "mun" ? colores.mun(k) : gkEf === "dep" ? colores.dep(k) : c[0]);
    const ch2: Cfg = { type: "bar", data: { labels: g15.map((x) => x.k), datasets: [
      { label: "Demanda típica por inmueble (kW)", fmt: "kw", data: g15.map((x) => x.tip), backgroundColor: g15.map((x) => colG(x.k)) },
      { label: "Inmueble más grande (kW)", fmt: "kw", data: g15.map((x) => x.kwMax), backgroundColor: g15.map((x) => colG(x.k) + "66") }] },
      options: { indexAxis: "y", interaction: { mode: "index", intersect: false } } };

    const PD = R.filter((r) => r.tar === GRUPO_BT), ppm = by(PD, (r) => r.per), pms = keys(ppm);
    const ch3: Cfg = { type: "bar", data: { labels: pms, datasets: [
      { type: "line", label: `Límite PDBT (${PDBT_MAX_KW} kW)`, data: pms.map(() => PDBT_MAX_KW), borderColor: c[0], borderDash: [6, 4], borderWidth: 2, pointRadius: 0, order: 1 },
      { type: "line", label: "Promedio estimado por recibo (kW)", data: pms.map((k) => { const a = ppm.get(k)!; return a.length ? sum(a, (r) => r.kwEst) / a.length : 0; }), borderColor: c[2], backgroundColor: c[2], borderWidth: 2, pointRadius: 2, tension: 0.3, order: 1 },
      { type: "bar", label: "Demanda estimada máxima (kW)", data: pms.map((k) => Math.max(0, ...ppm.get(k)!.map((r) => r.kwEst))), backgroundColor: colorTar(GRUPO_BT), order: 2 }] },
      options: { interaction: { mode: "index", intersect: false }, scales: { x: XT, y: { title: { display: true, text: "kW" } } } } };
    const exc = porRecibo(PD.filter((r) => r.kwOrig > limiteKw(r.tarCFE)).map((r) => ({ ...r, kw: r.kwOrig }))).sort((a, b) => b.kwMax - a.kwMax);

    /* PDBT y domésticas: qué tanto de su límite usa cada inmueble (sin sumar inmuebles) */
    const L = R.filter((r) => limiteKw(r.tarCFE) > 0), dL = demandas(L).map((x) => ({ ...x, pct: x.kw / limiteKw(x.r.tarCFE) }));
    const BANDAS_USO = [["Menos de 25 %", 0.25], ["25 a 50 %", 0.5], ["50 a 80 %", 0.8], ["80 a 100 %", 1.0001], ["Arriba del límite", Infinity]] as const;
    const banda = (p2: number) => BANDAS_USO.findIndex(([, t]) => p2 < t);
    const COL_USO = ["#4f86c6", "#3f9a7f", "#8fb04a", "#d08c2e", "#c0284e"];
    const chL: Cfg = { type: "bar", data: { labels: BANDAS_USO.map((b) => b[0]), datasets: [{ label: "Inmuebles", data: BANDAS_USO.map((_, i) => dL.filter((x) => banda(x.pct) === i).length), backgroundColor: COL_USO }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (y: any) => `${N(y.raw)} inmuebles (${PCT(y.raw, dL.length)})` } } },
        scales: { x: { title: { display: true, text: "Demanda máxima como % del límite de su tarifa" } }, y: { title: { display: true, text: "Inmuebles" } } } } };
    const proy = [...by(L, gf[gkEf])].map(([k, a]) => {
      const dg = demandas(a).map((x) => x.kw / limiteKw(x.r.tarCFE));
      return { k, tars: [...new Set(a.map((r) => r.tar))].sort(ordTar).join(", "), n: dg.length, tip: mediana(dg), cerca: dg.filter((p2) => p2 >= 0.8 && p2 <= 1).length, arriba: dg.filter((p2) => p2 > 1).length };
    }).sort((y, z2) => z2.n - y.n);
    const uso = { n: dL.length, tip: mediana(dL.map((x) => x.kw)), max: Math.max(0, ...dL.map((x) => x.kw)), pctTip: mediana(dL.map((x) => x.pct)),
      cerca: dL.filter((x) => x.pct >= 0.8 && x.pct <= 1).length, arriba: dL.filter((x) => x.pct > 1).length };

    const conKw = R.filter((r) => r.hasKw), fix = conKw.filter((r) => r.kwFix);
    const motivos = [...by(fix, (r) => r.kwFix.replace(/ · .*/, "").replace(/^[\d.,]+ veces su patrón.*también salió.*/, `${FACTOR_ATIPICO}× o más su patrón, con el consumo también fuera de patrón`).replace(/^[\d.,]+ veces su patrón.*/, `${FACTOR_ATIPICO}× o más su patrón sin respaldo del consumo`))]
      .map(([k, a]) => ({ k, n: a.length, rep: a.filter((r) => r.kwOk).length, rpu: nRec(a) })).sort((a, b) => b.n - a.n);
    const val = { meses: conKw.length, rpu: nRec(conKw), fix: fix.sort((a, b) => Math.abs(b.kwOrig - b.kw) - Math.abs(a.kwOrig - a.kw)), motivos,
      corr: fix.filter((r) => r.kwOk).length, desc: fix.filter((r) => !r.kwOk).length };
    const ref = referenciaFc(R), E = R.filter((r) => r.kwSrc === "estimada"), em = by(E, (r) => r.per), ems = keys(em);
    // Demanda estimada típica: mediana de la demanda máxima estimada de cada inmueble; el rango usa los cuartiles del FC
    const tipE = (fn: (r: Row) => number) => mediana([...by(E, (r) => r.rpu).values()].map((a) => Math.max(...a.map(fn))));
    void ems; void em;
    const est = { ref, n: nRec(E), meses: E.length, pico: tipE((r) => r.kwEst), max: Math.max(0, ...E.map((r) => r.kwEst)), bajo: tipE((r) => kwPorConsumo(r, ref.fcAlto)), alto: tipE((r) => kwPorConsumo(r, ref.fcBajo)),
      tar: [...new Set(E.map((r) => r.tar))].sort(ordTar).join(", ") };
    return { cmp, ch2, ch3, chL, uso, indiv, grupos, D, PD, exc, L, proy, val, est, medidos: nRec(R.filter((r) => r.kwSrc === "medida")) };
  }, [R, theme, gkEf, tsel, v, colores]);

  /* ── Subtotal del recibo contra el cálculo con la tabla oficial de CFE (tarifas con demanda) ── */
  const t = useMemo(() => {
    const G = R.filter((r) => TAR_DEMANDA.includes(r.tarCFE) && Number.isFinite(r.sub) && r.partes && r.kwh > 0);
    return { fact: sum(G, (r) => r.sub), calc: sum(G, (r) => r.calc), nG: G.length };
  }, [R]);

  /* ── Catálogo NodosP ── */
  const n = useMemo(() => {
    const nodos = of?.nodos?.nodos ?? [], c = PAL[theme].c;
    const zcs = [...new Set(nodos.map((x) => x.zonaCarga).filter(Boolean))].sort();
    const qq = normTxt(q);
    const lista = nodos.filter((x) => (!zc || x.zonaCarga === zc) && (!qq || normTxt(`${x.clave} ${x.nombre} ${x.municipio} ${x.zonaDist ?? ""} ${x.division ?? ""}`).includes(qq)));
    const rn = by(R, (r) => r.nodo), inmMun = new Map<string, Set<number>>();
    for (const r of R) { const k = normTxt(r.mun); const s = inmMun.get(k) ?? new Set<number>(); s.add(r.i); inmMun.set(k, s); }
    const res = zcs.map((z2) => {
      const ns = nodos.filter((x) => x.zonaCarga === z2), a = rn.get(z2) ?? [];
      return { z: z2, nn: ns.length, muns: [...new Set(ns.map((x) => x.municipio).filter(Boolean))].sort(), divs: [...new Set(ns.map((x) => x.division ?? "").filter(Boolean))].sort().join(", "),
        inm: distinct(a, (r) => r.i), kwh: sum(a, kwh), gasto: sum(a, tot), u: unit(a), dem: Math.max(0, ...demandas(a).map((x) => x.kw)), demTip: mediana(demandas(a).map((x) => x.kw)) };
    });
    const conInm = res.filter((x) => x.inm);
    // Costo y consumo por zona de carga; si el filtro deja una sola, por municipio, tarifa o dependencia
    const dimN = elegir(catsDe(R), ["zona de carga", "municipio", "tarifa", "dependencia"]);
    let ch: Cfg | null = null;
    if (dimN) {
      const grp = [...by(R, dimF[dimN])].map(([k, a]) => ({ k, g: sum(a, tot), w: sum(a, kwh) })).sort((x, y) => y.g - x.g).slice(0, 20);
      ch = barLine(grp.map((x) => x.k), grp.map((x) => x.g), grp.map((x) => x.w), c);
      ch.data.datasets[1].backgroundColor = grp.map((x) => colorDim(dimN, x.k));
    }
    const sinNodo = [...new Set(R.filter((r) => r.nodo === "Sin nodo").map((r) => r.mun))].sort();
    return { dimN, nodos, zcs, lista, res, ch, sinNodo, inmMun, muns: new Set(nodos.map((x) => normTxt(x.municipio))).size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [of, R, q, zc, theme, colores, dimF, munDeInm]);

  // Detalle de zona
  const zona = v.cn.includes(zonaSel) ? zonaSel : v.cn[0] ?? "";
  const z = useMemo(() => {
    const cs = v.ca.get(zona) ?? [], c = PAL[theme].c;
    const cm = by(cs, (r) => r.per), cls = keys(cm);
    const d1 = barLine(cls, cls.map((k) => sum(cm.get(k)!, tot)), cls.map((k) => sum(cm.get(k)!, kwh)), [colores.zona(zona), c[1]]);
    // Costo de la zona por tarifa; si hay una sola tarifa, por dependencia, municipio o inmueble
    const dimD2 = elegir(catsDe(cs), ["tarifa", "dependencia", "municipio", "inmueble"]);
    const d2 = dimD2 && ranking(cs, dimD2, (x) => sum(x, tot), P, "Costo", 15, EJE_PESOS);
    const deps = [...by(cs, (r) => r.dep)].map(([dd, a]) => ({ d: dd, a, t: sum(a, tot) })).sort((x, y) => y.t - x.t);
    return { cs, d1, d2, dimD2, deps };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, zona, theme, colores, dimF, munDeInm]);

  const toggleTheme = () => { const nt = theme === "dark" ? "light" : "dark"; setTheme(nt); try { localStorage.setItem("tema", nt); } catch { /* sin storage */ } };
  /** Al cambiar un filtro, se quitan los otros que ya no tienen recibos con la nueva combinación (y se avisa) */
  const set = (k: CampoF) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    let nf: Filtros = { ...f, [k]: e.target.value };
    const quitados: string[] = [];
    for (const o of CAMPOS_F) {
      if (o === k || !nf[o]) continue;
      if (!rows.some((r) => pasaF(r, nf, o) && campoF(r, o) === nf[o])) { quitados.push(`${NOMBRE_F[o]} «${nf[o]}»`); nf = { ...nf, [o]: "" }; }
    }
    setAvisoF(quitados.length ? `Se quitó el filtro de ${quitados.join(" y ")}: no tiene recibos con ${NOMBRE_F[k]} «${e.target.value}».` : "");
    setF(nf);
  };
  /** Aviso cuando una gráfica cambió de agrupación por los filtros */
  const Nota = ({ nat, act }: { nat: Dim; act: Dim | null }) => !act || act === nat ? null
    : <p className="d-mut d-nota">Agrupada por {act}: {v.cats[nat] <= 1 ? `con los filtros actuales solo hay ${nat === "zona" || nat === "tarifa" || nat === "división" || nat === "dependencia" || nat === "zona de carga" ? "una" : "un"} ${nat}` : "para no repetir lo que ya muestra otra gráfica de costo"}.</p>;
  const OPC = ({ l }: { l: [string, number][] }) => <>{l.map(([x]) => <option key={x} value={x}>{x}</option>)}</>;

  /* Hooks de la vista móvil: van antes del «return» de carga; si quedan después, React falla al llegar los datos
     («Rendered more hooks than during the previous render») */
  const esMovil = useEsMovil();
    const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
    const dashRef = useRef<HTMLDivElement>(null);

    // Asigna automáticamente el encabezado (th) a cada celda (td[data-th]) para vista de tarjetas en móvil
    useEffect(() => {
        const el = dashRef.current;
        if (!el) return;
        const MAX_FILAS_TARJETAS = 5;

        el.querySelectorAll(".d-tw").forEach((wrap) => {
          const tabla = wrap.querySelector("table");
          if (!tabla) return;
          const filas = tabla.querySelectorAll("tbody tr");
          const esCorta = !wrap.classList.contains("no-cards") && filas.length > 0 && filas.length <= MAX_FILAS_TARJETAS;

          wrap.classList.toggle("d-cards", esCorta);
          if (!esCorta) return;

          const headers = [...tabla.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
          filas.forEach((tr) => {
            tr.querySelectorAll("td").forEach((td, i) => {
              if (headers[i]) td.setAttribute("data-th", headers[i]);
            });
          });
        });
      });

  const numFiltrosActivos = CAMPOS_F.filter((k) => Boolean(f[k])).length;

  useEffect(() => {
    const nav = tabsRef.current;
    const activa = nav?.querySelector<HTMLButtonElement>(".d-tab.on");
    if (!nav || !activa) return;
    const destino = activa.offsetLeft - (nav.clientWidth - activa.offsetWidth) / 2;
    nav.scrollTo({ left: destino, behavior: "smooth" });
  }, [tab]);

  const tabsCentradas = useMemo(() => {
    const idx = TABS.findIndex(([k]) => k === tab);
    if (idx < 0) return TABS;
    const centro = Math.floor(TABS.length / 2);
    const shift = (idx - centro + TABS.length) % TABS.length;
    return [...TABS.slice(shift), ...TABS.slice(0, shift)];
  }, [tab]);

  if (!model) return <div className="dash" data-theme={theme}><main><h1>Recibos de CFE</h1><p className="d-sub">Cargando…</p></main></div>;

  const { T, K } = v;
  const periodo = rows.length ? `${rows.reduce((m, r) => (r.per < m ? r.per : m), rows[0].per)} a ${rows.reduce((m, r) => (r.per > m ? r.per : m), rows[0].per)}` : "";
  const costoProm = unit(R);
  /** Sin filtros los recuadros muestran el total de toda la base; con algún filtro lo marcan */
  const hayF = CAMPOS_F.some((k) => f[k]), etqF = hayF ? " · filtrado" : "";
  const zT = sum(z.cs, tot), zK = sum(z.cs, kwh);
  const dif = t.fact ? ((t.calc - t.fact) / t.fact) * 100 : 0;
  const ref = d.est.ref;
  /* ── Informes de cada gráfica: qué muestra, qué periodo cubre, cómo se calcula y cómo leerla ── */
  const persF = [...new Set(R.map((r) => r.per))].sort();
  const recMes = persF.map((p) => R.filter((r) => r.per === p).length), medRec = [...recMes].sort((a, b) => a - b)[recMes.length >> 1] ?? 0;
  const incompletos = persF.filter((_, i) => recMes[i] < medRec * 0.5);
  const PER = persF.length ? <>{persF[0]} a {persF[persF.length - 1]} ({persF.length} meses)</> : <>sin datos</>;
  const T3 = ({ t }: { t: string }) => <h3 className="d-inf-t">{t}</h3>;
  const FILTROS = <p>Todo se calcula con los recibos que dejan pasar los filtros de arriba (dependencia, tarifa, municipio y zona de carga).</p>;
  const AVISO_MESES = incompletos.length > 0
    ? <p><b>Meses incompletos:</b> {incompletos.join(", ")} tienen menos de la mitad de los recibos de un mes normal (aún no se cargan todos), así que se ven más bajos de lo real.</p> : null;
  const FUENTES_COSTO = <><ul>
    <li><b>Subtotal del recibo sin IVA</b> (columna <code>subtotal</code> de Supabase), que existe para todas las tarifas, GDMTH incluida.</li>
    <li><b>Tabla oficial de CFE</b> de su división y mes, también sin IVA, solo cuando el mes no trae subtotal (por ejemplo, precio impreso incompleto).</li>
  </ul><p>Todos los montos del tablero son <b>sin IVA</b>, para que PDBT y las tarifas con demanda se comparen en la misma base.</p></>;
  const DEM_RECIBO = <ul>
    <li><b>Recibos con lectura de kW</b> (GDMTH, GDMTO, GDBT…): la demanda máxima que trae el recibo ese mes, ya validada. Los meses marcados como <b>demanda dudosa</b> en Supabase, o con un error evidente, se reemplazan con la media del recibo (ver la última tarjeta de la pestaña Demanda).</li>
    <li><b>Recibos sin lectura</b> ({GRUPO_BT} y meses sin dato): se estima con su consumo, kWh del mes / (24 h · días del mes · FC). El FC (factor de carga) es {ref.fc.toFixed(3)}, la mediana de {N(ref.n)} {ref.origen}. En {GRUPO_BT} nunca pasa de {PDBT_MAX_KW} kW.</li>
    <li><b>Meses con lectura estimada</b> (el recibo no trae lectura real del medidor): su kWh no es real, así que no se les estima demanda.</li>
  </ul>;
  const SIN_PRECIO = v.sinPrecio.length > 0 ? <><p><b>Meses sin precio en el filtro</b> (no entran al $/kWh; su consumo sí cuenta y su subtotal, si existe, sí entra al gasto):</p>
    <table style={{ minWidth: 0, margin: "4px 0 10px" }}><thead><tr><th>Motivo</th><th className="n">Meses</th><th className="n">kWh</th></tr></thead>
      <tbody>{v.sinPrecio.map((x) => <tr key={x.k}><td>{x.txt}</td><td className="n">{N(x.n)}</td><td className="n">{N(x.kwh)}</td></tr>)}</tbody></table></> : null;
  const LEC_EST = v.lecEst.length > 0 ? <p><b>Lectura estimada:</b> {N(v.lecEst.length)} meses de {N(nRec(v.lecEst))} recibos no tienen lectura real del medidor. Un 0 kWh en esos meses no es consumo cero: es un dato que falta, así que el consumo real fue algo mayor al que se muestra.</p> : null;
  const CONS_AT = v.consAt.length > 0 ? <p><b>Consumo atípico:</b> {N(v.consAt.length)} meses de {N(nRec(v.consAt))} recibos tienen un consumo fuera de lo normal del inmueble: vienen marcados en Supabase (columna <code>consumo_atipico</code>) o su kWh es {FACTOR_ATIPICO} o más veces lo que marcan sus otros meses (en {NOMBRE_VERANO} se permite hasta {FACTOR_VERANO}× más por el aire acondicionado). Se siguen sumando, porque es lo que se facturó (puede ser una refacturación o una lectura acumulada); si un mes se dispara, revisa primero estos recibos. No se usan para estimar demanda.</p> : null;
  const DEF_DEMANDA = <><p><b>Qué es la demanda:</b> los kW que un inmueble pide <b>al mismo tiempo</b> en su momento de mayor uso (todos los equipos que prende a la vez). Describe el <b>tamaño</b> del inmueble, no lo que gasta en el tiempo: eso es el consumo (kWh). Una comparación útil: el consumo es la distancia que recorre un auto; la demanda, qué tan grande es su motor.</p>
    <p><b>Cuidado al sumarla:</b> sumar la demanda de varios inmuebles da un techo que en la práctica no se alcanza, porque cada uno tiene su pico en un día y hora distintos. Solo la gráfica «Suma de demandas máximas por mes» la suma, para comparar meses; para describir los inmuebles, el tablero usa la <b>demanda máxima</b> de cada inmueble (su mes más alto) y la describe con la <b>demanda típica</b> (la mediana: la mitad de los inmuebles está por debajo y la otra mitad por arriba) y el <b>inmueble más grande</b>.</p></>;
  const DEF_REFERENCIA = <p><b>Contra qué se compara:</b> {d.cmp.conContr > 0 ? <>la <b>demanda contratada</b> de cada inmueble ({N(d.cmp.conContr)} inmuebles la tienen en Supabase); </> : null}{d.cmp.conContr < v.dems.length ? <>{d.cmp.conContr > 0 ? "los demás, " : ""}contra el <b>rango de demanda de su tarifa</b> según CFE: PDBT hasta {PDBT_MAX_KW} kW, GDBT más de {PDBT_MAX_KW} kW, GDMTO menos de 100 kW y GDMTH 100 kW o más (domésticas: {LIMITE_DOMESTICA_KW} kW, supuesto). Un inmueble arriba de su rango podría necesitar otra tarifa; uno abajo, podría estar pagando una tarifa más cara de lo necesario.</> : null}</p>;
  const PROMEDIO_PONDERADO = <p><b>Es un promedio ponderado</b>, no el promedio de los precios: Σ pesos / Σ kWh. Un recibo grande pesa más que uno chico. Por ejemplo, un recibo de 10,000 kWh a $2.50 y uno de 100 kWh a $5.00 dan $2.52/kWh, no $3.75.</p>;
  const INFCO = {
    anual: <><T3 t="Qué muestra" /><p>Cuántos MWh se consumieron en cada año y qué parte del consumo del periodo representa cada uno.</p>
      <T3 t="Periodo" /><p>Cada fila es un año calendario con los meses que tienen datos; «Todo el periodo» suma {PER}. Un año con menos de 12 meses es parcial y no se puede comparar de frente con uno completo.</p>
      <T3 t="Cómo se calcula" /><p>Suma de los kWh de todos los recibos del año, entre 1,000 para pasar a MWh. El promedio mensual divide ese total entre los meses con datos del año.</p>{AVISO_MESES}{FILTROS}</>,
    mensual: <><T3 t="Qué muestra" /><p>Cuánta energía (kWh) consume la base cada mes{co.dimC ? <> y qué parte aporta cada {co.dimC}. Cada color es una categoría y conserva su color en todo el tablero; si hay más de 8, las menores se juntan en «Otras»</> : <> (con los filtros actuales no hay varias categorías que separar, así que se ve una sola barra por mes)</>}.</p>
      <T3 t="Se adapta al filtro" /><p>Agrupa por <b>tarifa → zona → dependencia → municipio → zona de carga</b>: usa la primera opción que tenga más de una categoría con los filtros actuales.</p>
      <T3 t="Periodo" /><p><b>Mes por mes</b>, de {PER}. Cada barra es el total de ese mes, no un acumulado.</p>
      <T3 t="Cómo se calcula" /><p>Suma de los kWh de todos los recibos de ese mes; la gráfica los separa por categoría. Cada recibo cuenta una sola vez por mes.</p>{LEC_EST}{CONS_AT}{AVISO_MESES}{FILTROS}</>,
    ranking: <><T3 t="Qué muestra" /><p>Cuánto consumió cada {co.dimR ?? "categoría"} en total y qué porcentaje del consumo representa (las 14 mayores; el resto en «Otras»).</p>
      <T3 t="Se adapta al filtro" /><p>Agrupa por <b>dependencia → tarifa → municipio → zona de carga → zona</b>, sin repetir la agrupación de la gráfica mensual.</p>
      <T3 t="Periodo" /><p><b>Acumulado de todo el periodo</b> ({PER}).</p>
      <T3 t="Cómo se calcula" /><p>Suma de los kWh de todos los meses de los recibos de cada categoría.</p>{FILTROS}</>,
    dem: <><T3 t="Qué muestra" /><p>El consumo de cada mes (barras, eje izquierdo, kWh) junto con la demanda de ese mismo mes (línea, eje derecho, kW), para ver si la demanda sube o baja al ritmo del consumo.</p>
      <T3 t="Periodo" /><p><b>Mes por mes</b>, de {PER}. Cada punto es el total de ese mes, no un acumulado.</p>
      <T3 t="Cómo se calcula" /><p><b>Consumo</b> = suma de los kWh de todos los recibos del mes. <b>Demanda típica</b> = la mediana de la demanda de los inmuebles ese mes: el tamaño de un inmueble típico. No se suman, porque cada inmueble tiene su pico en un momento distinto.</p>{DEM_RECIBO}
      <p>Al pasar el cursor por un mes se muestra su <b>factor de carga</b> = Σ kWh / (24 · días del mes · Σ kW de los inmuebles), un promedio ponderado de todos. Mide qué tan parejo es el uso: cerca de 100 % es una carga constante; un valor bajo indica picos de demanda con poco consumo sostenido.</p>
      <T3 t="Ten en cuenta" /><p>En los recibos sin lectura de kW la demanda se estima a partir del consumo, así que en esa parte la línea sube y baja con las barras por construcción. Para ver la relación real, filtra por tarifas con demanda medida (GDMTH, GDMTO).</p>{DEF_DEMANDA}{AVISO_MESES}{FILTROS}</>,
    cmp: <><T3 t="Qué muestra" /><p>El consumo de cada mes del año, una línea por año, para ver si un mes consume más o menos que el mismo mes del año anterior.</p>
      <T3 t="Periodo" /><p><b>Mes por mes</b>, un punto por mes de cada año. Los meses sin datos quedan sin punto.</p>
      <T3 t="Cómo se calcula" /><p>Suma de los kWh de todos los recibos de ese mes y año.</p>
      <T3 t="Ten en cuenta" /><p>Si un mes tiene pocos recibos cargados se ve más bajo de lo real; revisa los meses incompletos antes de concluir que el consumo bajó.</p>{AVISO_MESES}{FILTROS}</>
  };
  const INF = {
    cG: <><T3 t="Qué muestra" /><p>Qué tan grandes son los inmuebles: cuántos caen en cada rango de <b>demanda máxima</b> (kW), separados por {v.dims.cG ?? "tarifa"}. Cada color conserva su color en todo el tablero; si hay más de 8 categorías, las menores se juntan en «Otras».</p><T3 t="Se adapta al filtro" /><p>Agrupa por <b>tarifa → zona → dependencia → municipio → zona de carga</b>: usa la primera opción que tenga más de una categoría con los filtros actuales.</p>
      <T3 t="Periodo" /><p><b>Todo el periodo junto</b> ({PER}): cada inmueble cuenta una vez, con su mes de mayor demanda.</p>
      <T3 t="Cómo se calcula" /><p>Para cada inmueble se toma su demanda más alta del periodo y se ubica en su rango. La demanda de cada mes sale así:</p>{DEM_RECIBO}
      <p>En el filtro actual, la demanda típica por inmueble es {KW(v.demTip)} y el inmueble más grande pide {KW(v.demMax)}.</p>
      <T3 t="Términos" />{DEF_DEMANDA}{FILTROS}</>,
    cDM: <><T3 t="Qué muestra" /><p>Qué meses piden más demanda en total. Cada barra es la <b>suma de las demandas máximas</b> de ese mes de todos los recibos del filtro, separada por {v.dims.cG ?? "tarifa"} (las 8 mayores; el resto en «Otras»).</p>
      <T3 t="Periodo" /><p><b>Mes por mes</b>, de {PER}. Cada recibo aporta una sola vez por mes.</p>
      <T3 t="Cómo se calcula" /><p>Se suma el pico de cada recibo en ese mes, <b>después de normalizar los casos extraños</b> (meses fuera de patrón, dígitos pegados, demandas dudosas; ver «Consideraciones de la validación» en la pestaña Demanda):</p>
      <ul><li><b>GDMTH y GDMTO:</b> el kW medido que trae el recibo (corregido si salió fuera de patrón).</li>
        <li><b>PDBT y domésticas:</b> no traen kW, así que se usa la demanda estimada con su consumo (kWh / (24 · días · factor de carga)), sin pasar del máximo de su tarifa. Los meses con lectura estimada no se estiman.</li></ul>
      <p>El mes con la suma más alta es <b>{v.mesPico}</b>: {KW(v.sumPico)} entre {N(v.recPico)} recibos{v.estPico > 0 ? <>, de los que {KW(v.estPico)} ({PCT(v.estPico, v.sumPico)}) son demanda estimada</> : null}.</p>
      <T3 t="Cómo leerla" /><p>Sirve para comparar meses: si la barra crece en verano, más equipo (aire acondicionado, bombeo) está funcionando. Es un <b>techo</b>: cada inmueble tiene su pico en un momento distinto del mes, así que la demanda simultánea real de todos juntos es menor que esta suma. Un mes con menos recibos cargados también se ve más bajo (revisa el aviso de meses incompletos).</p>
      <T3 t="Términos" />{DEF_DEMANDA}{AVISO_MESES}{FILTROS}</>,
    cP: <><T3 t="Qué muestra" /><p>Cuántos recibos (RPU) hay de cada {v.recDim} y qué porcentaje representan de los recibos del filtro ({v.recN} categorías{v.recN > 15 ? "; se muestran las 14 mayores y el resto se junta en «Otras»" : ""}).</p><T3 t="Se adapta al filtro" /><p>Agrupa por <b>tarifa → dependencia → municipio → zona de carga</b>: usa la primera opción que tenga más de una categoría con los filtros actuales. Si ninguna tiene más de una, la gráfica se oculta porque no aportaría nada.</p>

      <T3 t="Periodo" /><p><b>Todo el periodo junto</b> ({PER}): un recibo cuenta una sola vez aunque tenga muchos meses de historial.</p>
      <T3 t="Cómo se calcula" /><p>% = recibos de la categoría / recibos totales del filtro ({N(nRec(R))}). La tarifa, dependencia y municipio son los del inmueble en Supabase; las domésticas (1, 1A–1F, DAC) se cuentan dentro de «{GRUPO_BT}». La tarifa sale de cada mes del historial (<code>historial_calculo.tarifa</code>), así que un recibo que cambió de tarifa en el periodo cuenta en cada una{v.cambioTar ? <> (en el filtro actual, {N(v.cambioTar)} recibos cambiaron de tarifa)</> : null}. Cada tarifa, municipio (color de su zona), zona de carga y dependencia conserva su color en todo el tablero.</p>
      <T3 t="Cómo leerla" /><p>Si una barra es muy chica, la gráfica arranca en escala log para que se vea; el tooltip siempre da el número exacto y el %.</p>{FILTROS}</>,
    c1: <><T3 t="Qué muestra" /><p>El gasto de cada mes (barras, atrás) y el consumo de cada mes (línea, al frente).</p>
      <T3 t="Periodo" /><p><b>Mes por mes</b>, de {PER}. Cada punto es el total de ese mes, no un acumulado.</p>
      <T3 t="Cómo se calcula" /><p><b>Costo del mes</b> = suma del costo de todos los recibos de ese mes. El costo de cada recibo sale de la primera fuente disponible:</p>{FUENTES_COSTO}
      <p><b>Consumo del mes</b> = suma de kWh de todos los recibos de ese mes.</p>
      <T3 t="Ten en cuenta" /><p>En el filtro actual, {PCT(v.kCosto, K)} del consumo tiene costo. Los meses sin subtotal ni tabla de CFE suman consumo pero no gasto, así que en esos meses la barra puede verse baja respecto a la línea.</p>
      {t.nG > 0 && <p><b>Comprobación con la tabla de CFE:</b> en {N(t.nG)} meses de GDMTH y GDMTO, el subtotal de los recibos suma {M(t.fact)} y el cálculo con la tarifa oficial {M(t.calc)} ({t.fact ? ((t.calc - t.fact) / t.fact * 100 >= 0 ? "+" : "") + ((t.calc - t.fact) / t.fact * 100).toFixed(1) : "0"} %). La diferencia viene sobre todo del reparto supuesto entre base, intermedia y punta.</p>}{LEC_EST}{AVISO_MESES}{FILTROS}</>,
    c2: <><T3 t="Qué muestra" /><p>Cuánto se gastó en total por cada {v.dims.c2 ?? "tarifa"} y qué porcentaje del gasto representa (las 14 mayores; el resto en «Otras»).</p><T3 t="Se adapta al filtro" /><p>Agrupa por <b>tarifa → zona de carga → zona → dependencia</b>: usa la primera opción que tenga más de una categoría con los filtros actuales y que no esté ya en otra gráfica de costo de esta pestaña (por dependencia o por municipio). Si ninguna tiene más de una, la gráfica se oculta porque no aportaría nada.</p>
      <T3 t="Periodo" /><p><b>Acumulado de todo el periodo</b> ({PER}): suma de todos los meses.</p>
      <T3 t="Cómo se calcula" /><p>Suma del costo de todos los meses de los recibos de cada tarifa. Fuentes del costo:</p>{FUENTES_COSTO}{FILTROS}</>,
    c3: <><T3 t="Qué muestra" /><p>Cuánto se paga en promedio por cada kWh, por {v.dims.c3 ?? "tarifa"} (las 8 con más consumo), mes a mes.</p><T3 t="Se adapta al filtro" /><p>Agrupa por <b>tarifa → zona → dependencia → municipio</b>: usa la primera opción que tenga más de una categoría con los filtros actuales. Si ninguna tiene más de una, la gráfica se oculta porque no aportaría nada.</p>
      <T3 t="Periodo" /><p><b>Mes por mes</b>, de {PER}: cada punto es el precio promedio de ese mes, no del periodo completo.</p>
      <T3 t="Cómo se calcula" /><p>$/kWh del mes = Σ subtotal sin IVA / Σ kWh, solo con los meses que traen <b>precio sin IVA</b> (columna <code>precio_sin_iva</code>). Es la misma fórmula que usa el mapa, así que los precios coinciden en los dos lugares. No incluye costos calculados con la tabla de CFE.</p>
      {PROMEDIO_PONDERADO}
      <T3 t="Ten en cuenta" /><p>Los meses de puro cargo fijo, refacturaciones y precios atípicos ya vienen marcados en Supabase y se dejan fuera. Si aun así un mes con pocos recibos se dispara, «Recortar extremos» evita que aplaste al resto.</p>
      {v.sinReal.length > 0 ? <p>Sin meses con precio, no aparecen: {v.sinReal.join(", ")}.</p> : null}{SIN_PRECIO}{FILTROS}</>,
    c6: <><T3 t="Qué muestra" /><p>{v.dims.c6Mes ? <>El gasto de cada mes repartido por {v.dims.c6} (apilado).</> : <>El gasto total por {v.dims.c6 ?? "municipio"}, de mayor a menor.{v.dims.c6 === "municipio" ? <> Todas las barras van en un solo color: entre más intenso, más gasto (la intensidad usa escala logarítmica para que los municipios chicos sigan viéndose). El nombre y el monto están en el eje y al pasar el cursor.</> : null}</>}</p><T3 t="Se adapta al filtro" /><p>Agrupa por <b>municipio → zona de carga</b> (la primera con más de una categoría que no use ya otra gráfica de costo). Si ninguna sirve, se vuelve <b>costo mensual por tarifa → dependencia → zona → zona de carga</b>, que agrega cómo cambia el gasto en el tiempo. No se usa «inmueble» porque repetiría la tabla de recibos de mayor gasto.</p><T3 t="Periodo" /><p>{v.dims.c6Mes ? <><b>Mes por mes</b>, de {PER}.</> : <><b>Acumulado de todo el periodo</b> ({PER}).</>}</p>
      <T3 t="Cómo se calcula" /><p>Suma del costo de todos los meses de los inmuebles de cada municipio. Fuentes del costo:</p>{FUENTES_COSTO}{FILTROS}</>,
    c7: <><T3 t="Qué muestra" /><p>Las 10 categorías de mayor gasto por {v.dims.c7 ?? "dependencia"} (la décima junta al resto en «Otras» si hay más).</p><T3 t="Se adapta al filtro" /><p>Agrupa por <b>dependencia → municipio → tarifa → zona de carga</b>: usa la primera opción que tenga más de una categoría con los filtros actuales y que no esté ya en otra gráfica de costo de esta pestaña. Si ninguna tiene más de una, la gráfica se oculta porque no aportaría nada.</p>
      <T3 t="Periodo" /><p><b>Acumulado de todo el periodo</b> ({PER}).</p>
      <T3 t="Cómo se calcula" /><p>Suma del costo de todos los meses de los inmuebles de cada dependencia; se ordenan de mayor a menor y se muestran las 10 primeras.</p>{FUENTES_COSTO}{FILTROS}</>,
    cmpD: <><T3 t="Qué muestra" /><p>Cuántos inmuebles tienen una demanda máxima acorde con {d.cmp.tipoRef === "contr" ? "su demanda contratada" : "el rango de su tarifa"}, y cuáles conviene revisar.</p>
      <T3 t="Periodo" /><p><b>Todo el periodo junto</b> ({PER}): cada inmueble cuenta una vez, con su mes de mayor demanda.</p>
      <T3 t="Cómo se calcula" />{DEF_REFERENCIA}<ul>
        <li><b>Arriba:</b> la demanda máxima pasa la referencia.</li>
        <li><b>Cerca (80–100 %):</b> está cerca del tope; un mes con más carga lo podría pasar.</li>
        <li><b>{d.cmp.tipoRef === "contr" ? "Uso adecuado (50–80 %)" : "Dentro del rango"}:</b> sin observaciones.</li>
        <li><b>{d.cmp.tipoRef === "contr" ? "Contratada de más (menos de 50 %)" : "Abajo del rango"}:</b> {d.cmp.tipoRef === "contr" ? "paga capacidad que no usa; se podría bajar la demanda contratada." : "la tarifa es para inmuebles más grandes; podría convenir otra."}</li></ul>
      <p>La demanda de cada inmueble sale así:</p>{DEM_RECIBO}
      <T3 t="Términos" />{DEF_DEMANDA}{FILTROS}</>,
    ch2: <><T3 t="Qué muestra" /><p>El tamaño de los inmuebles de cada grupo (según «Agrupar por»): la barra fuerte es la <b>demanda típica</b> y la clara, el <b>inmueble más grande</b>. Se muestran los 15 grupos con el inmueble más grande; la tabla trae todos.</p>
      <T3 t="Periodo" /><p><b>Todo el periodo junto</b> ({PER}): cada inmueble cuenta con su mes de mayor demanda.</p>
      <T3 t="Cómo se calcula" /><ul>
        <li><b>Demanda típica:</b> la mediana de la demanda máxima de los inmuebles del grupo.</li>
        <li><b>Inmueble más grande:</b> la demanda máxima más alta del grupo.</li>
        <li><b>Fuera de referencia:</b> inmuebles arriba o abajo de {d.cmp.tipoRef === "contr" ? "su demanda contratada" : "el rango de su tarifa"} (ver la primera tarjeta).</li>
        <li><b>% de meses estimados:</b> qué parte de los meses del grupo no traía lectura de kW y se estimó con el consumo. Mientras más alto, más aproximado es el dato.</li>
        <li><b>Factor de carga (medidos):</b> Σ kWh / Σ (kW · 24 h · días), solo con meses que traen lectura. Cerca de 100 % = uso parejo todo el día; bajo = picos cortos.</li>
        <li><b>Distribución + capacidad:</b> lo que esos dos cargos sumarían según la tabla de CFE, en todo el periodo.</li></ul>
      <T3 t="Demanda de cada recibo" />{DEM_RECIBO}<T3 t="Términos" />{DEF_DEMANDA}{FILTROS}</>,
    ch3: <><T3 t="Qué muestra" /><p>La demanda estimada de {GRUPO_BT} frente a su límite de {PDBT_MAX_KW} kW.</p>
      <T3 t="Periodo" /><p><b>Mes por mes</b>, de {PER}.</p>
      <T3 t="Cómo se calcula" /><ul>
        <li><b>Barras:</b> de todos los recibos del grupo, el que tuvo la demanda estimada más alta ese mes.</li>
        <li><b>Línea continua:</b> el promedio de la demanda estimada de los recibos de ese mes.</li>
        <li><b>Línea punteada:</b> el límite de {PDBT_MAX_KW} kW.</li></ul>
      <p>Estas tarifas no miden demanda: se estima como kWh del mes / (24 h · días · FC), con FC = {ref.fc.toFixed(3)} (rango {ref.fcBajo.toFixed(3)}–{ref.fcAlto.toFixed(3)}), sin pasar de {PDBT_MAX_KW} kW. Si un recibo sí trae una lectura válida de kW, se usa esa.</p>
      <T3 t="Ten en cuenta" /><p>Una barra pegada al límite indica recibos cuyo consumo es muy alto para la tarifa. Los recibos con lecturas mayores al límite aparecen en la tabla de abajo como posibles servicios mal clasificados (deberían ser GDBT).</p>{FILTROS}</>,
    chL: <><T3 t="Qué muestra" /><p>Qué tan cerca está cada inmueble de {GRUPO_BT} del límite de demanda de su tarifa ({PDBT_MAX_KW} kW en PDBT; {LIMITE_DOMESTICA_KW} kW en domésticas, supuesto porque la tarifa doméstica no fija un tope).</p>
      <T3 t="Periodo" /><p><b>Todo el periodo junto</b> ({PER}): cada inmueble cuenta con su mes de mayor demanda.</p>
      <T3 t="Cómo se calcula" /><p>% del límite = demanda máxima del inmueble / límite de su tarifa. Como estas tarifas no miden demanda, casi siempre es la estimada con el consumo (FC = {ref.fc.toFixed(3)}).</p>
      <T3 t="Cómo leerla" /><p>Los inmuebles en <b>80 a 100 %</b> pueden pasarse del límite en un mes con más carga; los de <b>arriba del límite</b> probablemente deberían estar en GDBT. Los de menos de 25 % tienen mucho margen.</p>{FILTROS}</>,
    c8: <><T3 t="Qué muestra" /><p>El gasto de cada mes repartido por {v.dims.c8 ?? "zona"} (apilado): la altura total es el gasto del mes y cada color es una categoría.</p><T3 t="Se adapta al filtro" /><p>Agrupa por <b>zona → municipio → tarifa → dependencia</b>: usa la primera opción que tenga más de una categoría con los filtros actuales. Si ninguna tiene más de una, la gráfica se oculta porque no aportaría nada.</p>
      <T3 t="Periodo" /><p><b>Mes por mes</b>, de {PER}.</p>
      <T3 t="Cómo se calcula" /><p>Para cada mes y zona, suma del costo de los recibos de los inmuebles de esa zona. La zona de cada inmueble sale de su municipio; si el municipio no coincide con ninguna zona, se usa la zona más cercana por coordenadas.</p>{FUENTES_COSTO}{AVISO_MESES}{FILTROS}</>,
    c9: <><T3 t="Qué muestra" /><p>Cuánto cuesta en promedio cada kWh por {v.dims.c9 ?? "zona"}.</p><T3 t="Se adapta al filtro" /><p>Agrupa por <b>zona → municipio → zona de carga → tarifa</b>: usa la primera opción que tenga más de una categoría con los filtros actuales. Si ninguna tiene más de una, la gráfica se oculta porque no aportaría nada.</p>
      <T3 t="Periodo" /><p><b>Todo el periodo junto</b> ({PER}): un solo valor por zona que junta todos sus meses, no el de un mes.</p>
      <T3 t="Cómo se calcula" /><p>$/kWh = Σ subtotal sin IVA / Σ kWh de todos los meses con precio sin IVA de cada categoría (la misma fórmula del mapa). Los meses sin precio no entran.</p>
      {PROMEDIO_PONDERADO}{FUENTES_COSTO}{FILTROS}</>,
    d1: <><T3 t="Qué muestra" /><p>El gasto (barras, atrás) y el consumo (línea, al frente) de la zona elegida en «Detalle de zona».</p>
      <T3 t="Periodo" /><p><b>Mes por mes</b>, de {PER}.</p>
      <T3 t="Cómo se calcula" /><p>Para cada mes, suma del costo y de los kWh de los recibos de los inmuebles de la zona.</p>{FUENTES_COSTO}{AVISO_MESES}{FILTROS}</>,
    d2: <><T3 t="Qué muestra" /><p>Cuánto se gastó por {z.dimD2 ?? "tarifa"} dentro de la zona elegida, con los mismos colores de todo el tablero.</p><T3 t="Se adapta al filtro" /><p>Agrupa por <b>tarifa → dependencia → municipio → inmueble</b>: usa la primera opción que tenga más de una categoría con los filtros actuales dentro de la zona. Si ninguna tiene más de una, la gráfica se oculta porque no aportaría nada.</p>
      <T3 t="Periodo" /><p><b>Acumulado de todo el periodo</b> ({PER}).</p>
      <T3 t="Cómo se calcula" /><p>Suma del costo de todos los meses de los recibos de cada tarifa dentro de la zona.</p>{FUENTES_COSTO}{FILTROS}</>,
    nc: <><T3 t="Qué muestra" /><p>El gasto (barras, atrás) y el consumo (línea, al frente) por {n.dimN ?? "zona de carga"} (las 20 de mayor gasto).</p><T3 t="Se adapta al filtro" /><p>Agrupa por <b>zona de carga → municipio → tarifa → dependencia</b>: usa la primera opción que tenga más de una categoría con los filtros actuales. Si ninguna tiene más de una, la gráfica se oculta porque no aportaría nada.</p>
      <T3 t="Periodo" /><p><b>Acumulado de todo el periodo</b> ({PER}): un valor por zona de carga.</p>
      <T3 t="Cómo se calcula" /><p>Cada inmueble se liga a una zona de carga por el NodoP capturado en el inmueble; si no lo tiene o no está en el catálogo, por su municipio (la zona de carga más frecuente entre los NodosP de ese municipio). Después se suman costo y kWh de todos sus meses.</p>{FUENTES_COSTO}{FILTROS}</>
  };

  /* Recuadros bajo los filtros: cambian con la pestaña */
  const KP: Record<Tab, [string, string][]> = {
    pg: [["Gasto total sin IVA" + etqF, M(T)], ["Consumo total" + etqF, N(K / 1000) + " MWh"],
      ...v.anual.flatMap((a): [string, string][] => [
        [`Consumo ${a.y}${a.meses < 12 ? ` (${a.meses} meses)` : ""}${etqF}`, N(a.kwh / 1000) + " MWh"],
        [`Demanda máxima del mes pico ${a.y}${a.meses < 12 ? ` (${a.meses} meses)` : ""}${etqF}`, `${MW(a.picoKw)} · ${a.picoMes}`]]),
      ["Costo promedio sin IVA", P(costoProm) + " /kWh"],  ["Inmuebles", N(distinct(R, (r) => r.i))]],
    co: [["Consumo total" + etqF, N(K / 1000) + " MWh"], ["Consumo mensual promedio", N(K / 1000 / Math.max(1, persF.length)) + " MWh"],
      ["Consumo promedio por recibo", N(K / Math.max(1, nRec(R))) + " kWh"], ["Meses con lectura estimada", N(v.lecEst.length)], ["Meses con consumo atípico", N(v.consAt.length)]],
    dm: [["Demanda máxima (inmueble más grande)", KW(v.demMax)], ["Demanda típica por inmueble", KW(v.demTip)],
      ["Inmuebles con kW medido", N(d.medidos)], ["Inmuebles con demanda estimada", N(d.est.n)],
      [d.cmp.tipoRef === "contr" ? "Arriba de la contratada" : "Arriba del rango de su tarifa", N(d.cmp.arriba)], ["Meses de kW corregidos", N(d.val.corr)]],
    pc: [["Zonas", N(v.cn.length)], ["Gasto sin IVA", M(T)], ["Consumo", N(K / 1000) + " MWh"], ["Costo promedio sin IVA", P(costoProm) + " /kWh"],
      ["Zona de mayor gasto", v.zTop ? v.zTop[0] : "—"], ["Inmuebles", N(distinct(R, (r) => r.i))]],
    np: of?.nodos ? [["NodosP en Tamaulipas", N(n.nodos.length)], ["Zonas de carga", N(n.zcs.length)], ["Municipios con NodoP", N(n.muns)],
      ["Inmuebles en una zona de carga", N(distinct(R.filter((r) => r.nodo !== "Sin nodo"), (r) => r.i))]] : []
  };


  return (
    <div className="dash" data-theme={theme} ref={dashRef}>
      <main>
        <div className="d-top">
          <div>
            <h1>Recibos de CFE · Dependencias de Tamaulipas</h1>
            <p className="d-sub">Histórico de consumo, demanda y costo por recibo, contrastado con las tarifas oficiales de CFE y el catálogo de NodosP del CENACE. Los filtros actualizan todas las gráficas.</p>
          </div>
          <div className="d-actions">
            <button className="d-btn" type="button" onClick={onBack}>← Mapa</button>
            <button className="d-btn" type="button" onClick={toggleTheme} aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}>{theme === "dark" ? "☀ Modo claro" : "☾ Modo oscuro"}</button>
          </div>
        </div>

        <div className={"d-note" + (of?.errores.length ? " warn" : "")}>
          {rows.length
            ? <><b>{N(nRec(rows))} recibos (RPU) · {N(rows.length)} meses de historial · {N(model.N)} inmuebles</b> · periodo analizado {MES_DESDE} a {MES_HASTA}{periodo && periodo !== `${MES_DESDE} a ${MES_HASTA}` ? <> (con datos: {periodo})</> : null}.{" "}</>
            : <><b>Sin historial.</b> Revisa la conexión con Supabase y los permisos de las vistas.{" "}</>}
          {!of ? "Cargando tarifas CFE y NodosP…" : <>
            {of.tar ? <>Tarifas CFE cargadas. </> : <>Sin tarifas oficiales (<code>node scripts/scrape-tarifas-cfe.mjs</code>). </>}
            {of.nodos ? <>Catálogo de NodosP cargado. </> : <>Sin catálogo de NodosP (<code>node scripts/scrape-nodosp-cenace.mjs</code>). </>}
          </>}
        </div>

        {esMovil && (
                  <div className="d-filtros-toggle">
                    <button
                      type="button"
                      className={"d-btn" + (numFiltrosActivos > 0 ? " activo" : "")}
                      aria-expanded={filtrosAbiertos}
                      onClick={() => setFiltrosAbiertos((v) => !v)}
                    >
                      <span>{filtrosAbiertos ? "Ocultar filtros" : `Filtros${numFiltrosActivos > 0 ? ` (${numFiltrosActivos})` : ""}`}</span>
                      <span aria-hidden="true">{filtrosAbiertos ? "▲" : "▼"}</span>
                    </button>
                  </div>
                )}

                {(!esMovil || filtrosAbiertos) && (
                  <div className="d-bar">
                    <label>Dependencia<select value={f.dep} onChange={set("dep")}><option value="">Todas las dependencias</option><OPC l={opts.dep} /></select></label>
                    <label>Tarifa<select value={f.tar} onChange={set("tar")}><option value="">Todas las tarifas</option><OPC l={opts.tar} /></select></label>
                    <label>División CFE<select value={f.div} onChange={set("div")}><option value="">Todas las divisiones</option><OPC l={opts.div} /></select></label>
                    <label>Municipio<select value={f.mun} onChange={set("mun")}><option value="">Todos los municipios</option><OPC l={opts.mun} /></select></label>
                    <label>Zona de carga<select value={f.nodo} onChange={set("nodo")}><option value="">Todas las zonas de carga</option><OPC l={opts.nodo} /></select></label>
                    <button className="d-btn" type="button" onClick={() => { setF(SIN_FILTROS); setAvisoF(""); }}>Limpiar filtros</button>
                  </div>
                )}


        {avisoF && <p className="d-mut d-aviso" role="status">{avisoF}</p>}

        {KP[tab].length > 0 && <Kpis items={KP[tab]} />}

        <nav className="d-tabs" role="tablist" ref={tabsRef}>
          {tabsCentradas.map(([k, l]) => <button key={k} className={"d-tab" + (tab === k ? " on" : "")} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </nav>

        {tab === "pg" && (
          <div className="d-grid">
            {v.charts.cDM && <div className="d-card w12"><Cab t={`Suma de demandas máximas por mes, por ${v.dims.cG}`} info={INF.cDM} /><Nota nat="tarifa" act={v.dims.cG} /><Grafica config={v.charts.cDM} theme={theme} tall modos={["pct", "sep"]} /></div>}
            {v.charts.cG && <div className={"d-card " + (v.charts.cP ? "w8" : "w12")}><Cab t={`Tamaño de los inmuebles (demanda máxima), por ${v.dims.cG}`} info={INF.cG} /><Nota nat="tarifa" act={v.dims.cG} /><Grafica config={v.charts.cG} theme={theme} tall modos={["pct", "sep"]} /></div>}
            {v.charts.cP && <div className={"d-card " + (v.charts.cG ? "w4" : "w12")}><Cab t={`Recibos por ${v.recDim}`} info={INF.cP} /><Nota nat="tarifa" act={v.dims.cP} /><Grafica config={v.charts.cP} theme={theme} alto={v.recAlto} modos={["log"]} /></div>}
            <div className={"d-card " + (v.charts.c2 ? "w8" : "w12")}><Cab t="Costo mensual y consumo" info={INF.c1} /><Grafica config={v.charts.c1} theme={theme} modos={["clip"]} /></div>
            {v.charts.c2 && <div className="d-card w4"><Cab t={`Costo por ${v.dims.c2}`} info={INF.c2} /><Nota nat="tarifa" act={v.dims.c2} /><Grafica config={v.charts.c2} theme={theme} alto={v.altoDe("c2")} modos={["log"]} /></div>}
            {v.charts.c3 && <div className="d-card w12"><Cab t={`Costo unitario ($/kWh) por ${v.dims.c3}`} info={INF.c3} /><Nota nat="tarifa" act={v.dims.c3} /><Grafica config={v.charts.c3} theme={theme} modos={["clip", "log"]} /></div>}
            {v.charts.c6 && <div className="d-card w12"><Cab t={v.dims.c6Mes ? `Costo mensual por ${v.dims.c6}` : `Costo por ${v.dims.c6}`} info={INF.c6} /><Nota nat="municipio" act={v.dims.c6} />
<Grafica config={v.charts.c6} theme={theme} alto={v.dims.c6Mes ? undefined : v.altoDe("c6")} modos={v.dims.c6Mes ? ["pct", "sep"] : ["log"]} /></div>}
            {v.charts.c7 && <div className="d-card w12"><Cab t={`10 mayores gastos por ${v.dims.c7}`} info={INF.c7} /><Nota nat="dependencia" act={v.dims.c7} /><Grafica config={v.charts.c7} theme={theme} alto={v.altoDe("c7")} modos={["log"]} /></div>}
            <div className="d-card w12"><h2>Recibos de mayor gasto en el periodo</h2>
              <div className="d-tw"><table>
                <thead><tr><th>RPU</th><th>Inmueble</th><th>Dependencia</th><th>Municipio</th><th>Tarifa</th><th>Historial</th><th className="n">Meses</th><th className="n">kWh</th><th className="n">kW máx.</th><th className="n">Total</th><th>Origen</th></tr></thead>
                <tbody>{v.top.map((x) => (
                  <tr key={x.rpu}><td>{x.rpu}</td><td>{model.props[x.r.i].nombre}</td><td>{x.r.dep}</td><td>{x.r.mun}</td><td>{x.r.tar}</td><td>{x.desde} a {x.hasta}</td><td className="n">{x.n}</td>
                    <td className="n">{N(x.kwh)}</td><td className="n">{N(x.kwMax)}</td><td className="n">{P(x.total)}</td><td>{x.cfe ? "Tabla CFE" : "Subtotal"}</td></tr>
                ))}</tbody>
              </table></div>
            </div>
          </div>
        )}

        {tab === "co" && (
          <div className="d-grid">
            {v.anual.length > 0 && <div className="d-card w12">
              <Cab t={<>Consumo por año </>} info={INFCO.anual} />
              <div className="d-tw full"><table>
                <thead><tr><th>Año</th><th className="n">Meses con datos</th><th className="n">Consumo (MWh)</th><th className="n">Consumo mensual promedio (MWh)</th><th className="n">% del consumo</th></tr></thead>
                <tbody>{v.anual.map((a) => (
                  <tr key={a.y}><td>{a.y}{a.meses < 12 ? " (parcial)" : ""}</td><td className="n">{a.meses}</td><td className="n">{N(a.kwh / 1000)}</td><td className="n">{N(a.kwh / 1000 / Math.max(1, a.meses))}</td><td className="n">{PCT(a.kwh, K)}</td></tr>
                ))}
                {v.anual.length > 1 && <tr><td><b>Todo el periodo</b></td><td className="n"><b>{persF.length}</b></td><td className="n"><b>{N(K / 1000)}</b></td><td className="n"><b>{N(K / 1000 / Math.max(1, persF.length))}</b></td><td className="n"><b>{PCT(K, K)}</b></td></tr>}</tbody>
              </table></div>

            </div>}
            <div className={"d-card " + (co.ranking2 ? "w8" : "w12")}><Cab t={co.dimC ? `Consumo mensual por ${co.dimC}` : "Consumo mensual"} info={INFCO.mensual} /><Grafica config={co.mensual} theme={theme} tall modos={co.dimC ? ["pct", "sep"] : undefined} /></div>
            {co.ranking2 && <div className="d-card w4"><Cab t={`Consumo por ${co.dimR}`} info={INFCO.ranking} /><Grafica config={co.ranking2} theme={theme} alto={Math.max(300, (co.ranking2.data.labels.length ?? 1) * 22 + 60)} modos={["log"]} /></div>}
            <div className="d-card w12"><Cab t="Consumo contra demanda" info={INFCO.dem} /><Grafica config={co.cd} theme={theme} tall /></div>
            {co.cmp && <div className="d-card w12"><Cab t="Consumo mensual, año contra año" info={INFCO.cmp} /><Grafica config={co.cmp} theme={theme} /></div>}
            <div className="d-card w12"><h2>Recibos de mayor consumo en el periodo</h2>
              <div className="d-tw"><table>
                <thead><tr><th>RPU</th><th>Inmueble</th><th>Dependencia</th><th>Municipio</th><th>Tarifa</th><th>Historial</th><th className="n">Meses</th><th className="n">Consumo (kWh)</th><th className="n">Promedio mensual (kWh)</th><th className="n">% del consumo</th></tr></thead>
                <tbody>{co.top.map((x) => (
                  <tr key={x.rpu}><td>{x.rpu}</td><td>{model.props[x.r.i].nombre}</td><td>{x.r.dep}</td><td>{x.r.mun}</td><td>{x.r.tar}</td><td>{x.desde} a {x.hasta}</td><td className="n">{x.n}</td>
                    <td className="n">{N(x.kwh)}</td><td className="n">{N(x.kwh / Math.max(1, x.n))}</td><td className="n">{PCT(x.kwh, K)}</td></tr>
                ))}</tbody>
              </table></div>
            </div>
          </div>
        )}

        {tab === "dm" && (
          <div className="d-grid">
            {d.cmp.cfg && <div className="d-card w12"><Cab t={d.cmp.tipoRef === "contr" ? "Demanda máxima contra la demanda contratada" : "Demanda máxima contra el rango de su tarifa"} info={INF.cmpD} />
              <Grafica config={d.cmp.cfg} theme={theme} alto={220} />
              {d.cmp.revisar.length > 0 && <><p className="d-mut">Inmuebles a revisar (arriba, cerca del tope o {d.cmp.tipoRef === "contr" ? "con contratada de más" : "abajo del rango"}):</p>
              <div className="d-tw"><table>
                <thead><tr><th>RPU</th><th>Inmueble</th><th>Tarifa</th><th>Municipio</th><th className="n">Demanda máx.</th><th>Referencia</th><th className="n">Uso</th><th>Fuente</th><th>Situación</th></tr></thead>
                <tbody>{d.cmp.revisar.slice(0, 40).map((x) => (
                  <tr key={x.rpu}><td>{x.rpu}</td><td>{model.props[x.r.i].nombre}</td><td>{x.r.tarCFE}</td><td>{x.r.mun}</td><td className="n">{KW(x.kw)}</td><td>{x.refTxt}</td>
                    <td className="n">{Number.isFinite(x.uso) ? (x.uso * 100).toFixed(0) + " %" : "—"}</td><td>{x.medida ? "Medida" : "Estimada"}</td><td><Punto c={COLOR_ESTADO[x.estado]} />{d.cmp.etqE(x)}</td></tr>
                ))}</tbody>
              </table></div>
              {d.cmp.revisar.length > 40 && <p className="d-mut">Se muestran 40 de {N(d.cmp.revisar.length)}.</p>}</>}
            </div>}

            <div className="d-card w12"><h2>Demanda máxima individual</h2>
              <div className="d-bar"><label>Tarifa<select value={tsel} onChange={(e) => setTsel(e.target.value)}><option value="">General (todas las tarifas)</option>
                {v.tarsAll.map((x) => <option key={x}>{x}</option>)}</select></label></div>
              <Kpis items={[["Demanda máx.", KW(d.indiv.max)], ["Demanda típica (mediana)", KW(d.indiv.prom)], ["Recibos (RPU)", N(d.indiv.n)], ["Con lectura medida", N(d.indiv.medidos)]]} />
              {d.indiv.pico && <p className="d-mut">Pico: RPU {d.indiv.pico.rpu} · {model.props[d.indiv.pico.i].nombre} · {d.indiv.pico.tar} · {d.indiv.pico.per} ({d.indiv.pico.kwSrc}).</p>}
              <div className="d-tw"><table>
                <thead><tr><th>RPU</th><th>Inmueble</th><th>Tarifa</th><th>Municipio</th><th>Mes del pico</th><th className="n">kW máx.</th><th>Referencia</th><th className="n">Uso</th><th>Fuente</th><th className="n">Meses</th></tr></thead>
                <tbody>{d.indiv.top.map((y) => (
                  <tr key={y.rpu}><td>{y.rpu}</td><td>{model.props[y.m.i].nombre}</td><td>{y.m.tar}</td><td>{y.m.mun}</td><td>{y.m.per}</td><td className="n">{KW(y.m.kwEst)}</td>
                    <td>{d.indiv.refDe.get(y.rpu)?.refTxt ?? "—"}</td><td className="n">{(() => { const u = d.indiv.refDe.get(y.rpu)?.uso; return u != null && Number.isFinite(u) ? (u * 100).toFixed(0) + " %" : "—"; })()}</td>
                    <td>{y.m.kwSrc === "medida" ? (y.m.kwFix ? "Medida (corregida)" : "Medida") : "Estimada"}</td><td className="n">{y.n}</td></tr>
                ))}</tbody>
              </table></div>
            </div>

            {gkOps.length > 0 && <div className="d-card w12"><Cab t="Tamaño de los inmuebles por grupo" info={INF.ch2} />
              <div className="d-bar"><label>Agrupar por<select value={gkEf} onChange={(e) => setGk(e.target.value as GK)}>{(gkOps.length ? gkOps : GKS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label></div>
              <Grafica config={d.ch2} theme={theme} alto={Math.max(300, Math.min(d.grupos.length, 15) * 34 + 60)} modos={["log"]} />
              <div className="d-tw"><table>
                <thead><tr><th>{GKS.find((x) => x[0] === gkEf)![1]}</th><th>Tarifas</th><th className="n">Inmuebles</th><th className="n">Recibos (RPU)</th><th className="n">Demanda típica</th><th className="n">Inmueble más grande</th><th className="n">Fuera de referencia</th><th className="n">% de meses estimados</th><th className="n">Factor de carga (medidos)</th><th className="n">Distribución + capacidad</th></tr></thead>
                <tbody>{d.grupos.map((x) => (
                  <tr key={x.k}><td>{colorGrupo(x.k) && <Punto c={colorGrupo(x.k)} />}{x.k}</td><td>{x.tars}</td><td className="n">{N(x.n)}</td><td className="n">{N(x.rec)}</td><td className="n">{KW(x.tip)}</td><td className="n">{KW(x.kwMax)}</td><td className="n">{N(x.fuera)}</td>
                    <td className="n">{x.est}</td><td className="n">{x.fc ? (x.fc * 100).toFixed(1) + " %" : "—"}</td><td className="n">{x.cDem ? M(x.cDem) : "—"}</td></tr>
                ))}</tbody>
              </table></div>
            </div>}

            {d.PD.length > 0 && <>
              <div className="d-card w8"><Cab t={`${GRUPO_BT}: demanda estimada contra el límite de ${PDBT_MAX_KW} kW`} info={INF.ch3} /><Grafica config={d.ch3} theme={theme} modos={["clip"]} /></div>
              <div className="d-card w4"><h2>{GRUPO_BT}</h2>
                <Kpis items={[["Recibos", N(nRec(d.PD))], ["Demanda estimada máx.", KW(Math.max(0, ...d.PD.map((r) => r.kwEst)))], ["Lecturas > " + PDBT_MAX_KW + " kW", N(d.exc.length)]]} />
                <p className="d-mut">Las domésticas (1, 1A–1F, DAC) se muestran junto con PDBT. Ninguna mide demanda: se estima con el consumo de cada mes.</p>
              </div>
              {d.exc.length > 0 && <div className="d-card w12"><h2>Recibos de {GRUPO_BT} con lecturas mayores a su límite</h2>
                <div className="d-tw"><table>
                  <thead><tr><th>RPU</th><th>Inmueble</th><th>Dependencia</th><th>Municipio</th><th>Historial</th><th className="n">Meses que exceden</th><th className="n">kW máx. leído</th></tr></thead>
                  <tbody>{d.exc.slice(0, 50).map((x) => (
                    <tr key={x.rpu}><td>{x.rpu}</td><td>{model.props[x.r.i].nombre}</td><td>{x.r.dep}</td><td>{x.r.mun}</td><td>{x.desde} a {x.hasta}</td><td className="n">{x.exc}</td><td className="n x">{KW(x.kwMax)}</td></tr>
                  ))}</tbody>
                </table></div></div>}
            </>}

            {d.uso.n > 0 && <div className="d-card w12"><Cab t={`${GRUPO_BT}: qué tan cerca están de su límite`} info={INF.chL} />
              <Kpis items={[["Inmuebles", N(d.uso.n)], ["Demanda típica", KW(d.uso.tip)], ["Uso típico del límite", PCT(d.uso.pctTip, 1)], ["Inmueble más grande", KW(d.uso.max)],
                ["Cerca del límite (80–100 %)", N(d.uso.cerca)], ["Arriba del límite", N(d.uso.arriba)]]} />
              <Grafica config={d.chL} theme={theme} />
              <div className="d-tw"><table>
                <thead><tr><th>{GKS.find((x) => x[0] === gkEf)![1]}</th><th>Tarifas</th><th className="n">Inmuebles</th><th className="n">Uso típico del límite</th><th className="n">Cerca del límite</th><th className="n">Arriba del límite</th></tr></thead>
                <tbody>{d.proy.map((x) => (
                  <tr key={x.k}><td>{colorGrupo(x.k) && <Punto c={colorGrupo(x.k)} />}{x.k}</td><td>{x.tars}</td><td className="n">{N(x.n)}</td><td className="n">{PCT(x.tip, 1)}</td><td className="n">{N(x.cerca)}</td><td className="n">{N(x.arriba)}</td></tr>
                ))}</tbody>
              </table></div>
            </div>}

            <div className="d-card w12"><h2>Estimación de demanda sin lectura</h2>
              <Kpis items={[["Recibos (RPU) estimados", N(d.est.n)], ["Factor de carga de referencia", ref.fc.toFixed(3)], ["Rango del FC (p25–p75)", `${ref.fcBajo.toFixed(3)} – ${ref.fcAlto.toFixed(3)}`],
                ["Demanda estimada típica", KW(d.est.pico)], ["Rango de la típica", `${KW(d.est.bajo)} – ${KW(d.est.alto)}`], ["Estimada más alta", KW(d.est.max)]]} />
              <p className="d-mut">Demanda estimada = kWh del mes / (24 · días · FC), con el FC de {N(ref.n)} {ref.origen}. Tarifas estimadas: {d.est.tar || "—"}. El detalle está en «Validación y metodología».</p>
            </div>

            <div className="d-card w12"><div className="d-hrow"><h2>Validación de las lecturas de demanda</h2>
                <InfoPop titulo="Consideraciones de la validación">
                <p>Los kW se capturan del recibo y a veces traen errores, como dígitos pegados (36,707 kW en un servicio que siempre marca 16–22 kW). Antes de calcular cualquier indicador, cada recibo se compara contra su propio historial y un mes se corrige si cumple alguna de estas condiciones:</p>
                <ol>
                  <li><b>Fuera de su patrón:</b> su kW es {FACTOR_ATIPICO} o más veces lo que marcan los <b>otros</b> meses del mismo RPU (basta con {MIN_MUESTRA - 1} meses más; el mes revisado no cuenta para su propia referencia, así un solo valor disparado no la infla aunque haya pocos datos). Cuando hay menos de 6 meses de referencia, el patrón es el grupo más grande de meses parecidos entre sí (el mayor no más de {DISPERSION_PATRON} veces el menor), que debe ser al menos la mitad de los meses y 2 o más; así otro mes raro (por ejemplo, el mes siguiente a una refacturación) no impide ver el patrón. Si no hay ese grupo, no se corrige nada.
                    <br />Los meses de {NOMBRE_VERANO} se comparan contra otros meses de verano; si el recibo solo tiene meses frescos, en verano se permite hasta {FACTOR_VERANO} veces su patrón antes de aplicar la regla, por el aire acondicionado.
                    <br />Si el consumo sube en proporción y está dentro de su propio patrón, el pico es real y no se toca. Si el consumo también se disparó (por ejemplo 88,000 kWh en un servicio que marca 3,400–4,200), los dos datos están fuera de lo normal (refacturación, lectura acumulada o error de captura) y el kW se corrige.
                    <br />Solo se corrigen <b>meses sueltos</b>: si cualquier otro mes del recibo marca un valor parecido (no más de {DISPERSION_PATRON} veces de diferencia), el inmueble de verdad llega a ese nivel (cambio de nivel, temporada de más uso) y el dato se respeta. Tampoco se revisan saltos chicos (menos de {MIN_KW_ATIPICO} kW o {N(MIN_KWH_ATIPICO)} kWh), que no mueven ningún indicador.</li>
                  <li><b>Demanda dudosa:</b> el mes viene marcado así en Supabase (columna <code>demanda_dudosa</code>); es la misma marca que usa el mapa.</li>
                  <li><b>kW en cero</b> en un mes con consumo (salvo meses con lectura estimada, que no tienen consumo real).</li>
                  <li><b>kW físicamente imposible:</b> menor que la demanda media del mes (kWh / 24 · días), lo que implicaría consumir más energía de la que permite esa demanda.</li>
                  <li><b>Excede el máximo de su tarifa:</b> más de {PDBT_MAX_KW} kW en PDBT o más de {LIMITE_DOMESTICA_KW} kW en domésticas.</li>
                </ol>
                <p>El valor corregido es la <b>media de los meses válidos del mismo RPU</b>, de la misma temporada (verano o resto del año) cuando los hay, sin bajar de la demanda media del consumo; si ese consumo también estaba fuera de patrón, el mínimo sale del consumo que marca el patrón. Si el recibo no tiene meses válidos, ese mes queda fuera de los indicadores de demanda. El kW original se conserva y aparece en esta tabla.</p>
                </InfoPop></div>
              <Kpis items={[["Meses con lectura de kW", N(d.val.meses)], ["Recibos (RPU) con kW", N(d.val.rpu)], ["Meses corregidos", N(d.val.corr)], ["Meses descartados", N(d.val.desc)], ["% de meses ajustados", PCT(d.val.fix.length, d.val.meses)]]} />
              {d.val.motivos.length > 0 ? <div className="d-tw"><table>
                <thead><tr><th>Motivo</th><th className="n">Meses</th><th className="n">Reemplazados con la media</th><th className="n">Recibos (RPU)</th></tr></thead>
                <tbody>{d.val.motivos.map((x) => <tr key={x.k}><td>{x.k}</td><td className="n">{N(x.n)}</td><td className="n">{N(x.rep)}</td><td className="n">{N(x.rpu)}</td></tr>)}</tbody>
              </table></div> : <p className="d-mut">Todas las lecturas de kW del filtro pasaron la validación.</p>}
              {d.val.fix.length > 0 && <div className="d-tw"><table>
                <thead><tr><th>RPU</th><th>Inmueble</th><th>Tarifa</th><th>Periodo</th><th className="n">kWh</th><th className="n">kW del recibo</th><th className="n">kW usado</th><th>Motivo</th></tr></thead>
                <tbody>{d.val.fix.slice(0, 40).map((r) => (
                  <tr key={r.rpu + r.per}><td>{r.rpu}</td><td>{model.props[r.i].nombre}</td><td>{r.tar}</td><td>{r.per}</td><td className="n">{N(r.kwh)}</td><td className="n x">{KW(r.kwOrig)}</td>
                    <td className="n">{r.kwOk ? KW(r.kw) : "Descartado"}</td><td>{r.kwFix}</td></tr>
                ))}</tbody>
              </table></div>}
              {d.val.fix.length > 40 && <p className="d-mut">Se muestran 40 de {N(d.val.fix.length)}.</p>}
            </div>
          </div>
        )}

        {tab === "pc" && (
          <div className="d-grid">
            {v.charts.c8 && <div className={"d-card " + (v.charts.c9 ? "w8" : "w12")}><Cab t={`Costo mensual por ${v.dims.c8}`} info={INF.c8} /><Nota nat="zona" act={v.dims.c8} /><Grafica config={v.charts.c8} theme={theme} modos={["pct", "sep"]} /></div>}
            {v.charts.c9 && <div className={"d-card " + (v.charts.c8 ? "w4" : "w12")}><Cab t={`Costo unitario por ${v.dims.c9}`} info={INF.c9} /><Nota nat="zona" act={v.dims.c9} /><Grafica config={v.charts.c9} theme={theme} alto={v.altoDe("c9")} modos={["log"]} /></div>}
            <div className="d-card w12"><h2>Comparativo por zona</h2>
              <div className="d-tw"><table>
                <thead><tr><th>Zona</th><th className="n">Dependencias</th><th className="n">Inmuebles</th><th className="n">Recibos (RPU)</th><th className="n">MWh</th><th className="n">Gasto</th><th className="n">% del total</th><th className="n">$/kWh</th><th className="n">kW máx.</th></tr></thead>
                <tbody>{v.cn.map((c) => {
                  const a = v.ca.get(c)!, tt = sum(a, tot);
                  return (
                    <tr key={c} className="d-click" onClick={() => { setZonaSel(c); zonaRef.current?.scrollIntoView({ block: "center" }); }}>
                      <td><Punto c={colores.zona(c)} />{c}</td><td className="n">{distinct(a, (r) => r.dep)}</td><td className="n">{N(distinct(a, (r) => r.i))}</td><td className="n">{N(nRec(a))}</td>
                      <td className="n">{N(sum(a, kwh) / 1000)}</td><td className="n">{M(tt)}</td><td className="n">{PCT(tt, T)}</td><td className="n">{P(unit(a))}</td><td className="n">{N(maxKw(a))}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            </div>
            <div className="d-card w12"><h2>Detalle de zona</h2>
              <label className="d-lab">Zona<select ref={zonaRef} value={zona} onChange={(e) => setZonaSel(e.target.value)}>{v.cn.map((c) => <option key={c}>{c}</option>)}</select></label>
              <Kpis id="ck" items={[
                ["Gasto", M(zT)], ["% del gasto total", PCT(zT, T)], ["Consumo", N(zK / 1000) + " MWh"], ["Costo promedio", P(unit(z.cs)) + " /kWh"],
                ["Dependencias", distinct(z.cs, (r) => r.dep)], ["Inmuebles", N(distinct(z.cs, (r) => r.i))], ["Demanda máxima", N(maxKw(z.cs)) + " kW"], ["Recibos (RPU)", N(nRec(z.cs))]
              ]} />
            </div>
            <div className={"d-card " + (z.d2 ? "w8" : "w12")}><Cab t="Costo y consumo mensual de la zona" info={INF.d1} /><Grafica config={z.d1} theme={theme} modos={["clip"]} /></div>
            {z.d2 && <div className="d-card w4"><Cab t={`Costo por ${z.dimD2} en la zona`} info={INF.d2} /><Grafica config={z.d2} theme={theme} modos={["log"]} /></div>}
            <div className="d-card w12"><h2>Dependencias de la zona</h2>
              <div className="d-tw"><table>
                <thead><tr><th>Dependencia</th><th className="n">Inmuebles</th><th>Municipios</th><th>Tarifas</th><th className="n">MWh</th><th className="n">Gasto</th><th className="n">$/kWh</th><th className="n">kW máx.</th></tr></thead>
                <tbody>{z.deps.map(({ d: dd, a, t: tt }) => (
                  <tr key={dd}><td>{dd}</td><td className="n">{N(distinct(a, (r) => r.i))}</td><td>{[...new Set(a.map((r) => r.mun))].sort().join(", ")}</td><td>{[...new Set(a.map((r) => r.tar))].sort().join(", ")}</td>
                    <td className="n">{N(sum(a, kwh) / 1000)}</td><td className="n">{M(tt)}</td><td className="n">{P(unit(a))}</td><td className="n">{N(maxKw(a))}</td></tr>
                ))}</tbody>
              </table></div>
            </div>
          </div>
        )}

        {tab === "np" && (
          <div className="d-grid">
            {!of?.nodos ? <Falta que="catálogo de NodosP" cmd="node scripts/scrape-nodosp-cenace.mjs" /> : <>
              {n.ch && <div className="d-card w12"><Cab t={`Costo y consumo por ${n.dimN}`} info={INF.nc} /><Nota nat="zona de carga" act={n.dimN} /><Grafica config={n.ch} theme={theme} modos={["log"]} />
                <p className="d-mut"><b>Nota:</b> las zonas de carga son una estimación. No se tiene el NodoP exacto de cada inmueble, así que a cada recibo se le asigna la zona de carga de su municipio según el catálogo de CENACE; los montos por zona de carga son aproximados.</p></div>}
              <div className="d-card w12"><h2>Resumen por zona de carga</h2>
                <div className="d-tw"><table>
                  <thead><tr><th>Zona de carga</th><th>División CFE</th><th className="n">NodosP</th><th>Municipios</th><th className="n">Inmuebles</th><th className="n">MWh</th><th className="n">Gasto</th><th className="n">$/kWh</th><th className="n">Demanda típica</th><th className="n">Inmueble más grande</th></tr></thead>
                  <tbody>{n.res.map((x) => (
                    <tr key={x.z} className="d-click" onClick={() => setZc(x.z)}><td><Punto c={colores.zc(x.z)} />{x.z}</td><td>{x.divs || "—"}</td><td className="n">{N(x.nn)}</td><td style={{ whiteSpace: "normal", minWidth: 220 }}>{x.muns.join(", ")}</td><td className="n">{N(x.inm)}</td>
                      <td className="n">{N(x.kwh / 1000)}</td><td className="n">{M(x.gasto)}</td><td className="n">{x.u ? P(x.u) : "—"}</td><td className="n">{KW(x.demTip)}</td><td className="n">{KW(x.dem)}</td></tr>
                  ))}</tbody>
                </table></div>
              </div>
              <div className="d-card w12"><h2>Catálogo de NodosP</h2>
                <div className="d-bar">
                  <label>Buscar<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Clave, nombre, municipio o zona" /></label>
                  <label>Zona de carga<select value={zc} onChange={(e) => setZc(e.target.value)}><option value="">Todas</option>{n.zcs.map((x) => <option key={x}>{x}</option>)}</select></label>
                  <span className="d-mut">{N(n.lista.length)} nodos</span>
                </div>
                <div className="d-tw"><table>
                  <thead><tr><th>Clave</th><th>Nombre</th><th>Zona de carga</th><th>Tensión (kV)</th><th>Municipio</th><th>División de distribución</th><th>Zona de distribución</th><th>Zona de transmisión</th><th>Centro de control</th><th>Sistema</th><th className="n">Inmuebles en el municipio</th></tr></thead>
                  <tbody>{n.lista.slice(0, 400).map((x) => (
                    <tr key={x.tipo + x.clave}><td>{x.clave}</td><td>{x.nombre}</td><td>{x.zonaCarga && <Punto c={colores.zc(x.zonaCarga)} />}{x.zonaCarga}</td><td>{x.tension}</td><td>{x.municipio}</td><td>{x.division || "—"}</td><td>{x.zonaDist || "—"}</td><td>{x.zonaTrans || "—"}</td><td>{x.ccr}</td><td>{x.sistema}</td>
                      <td className="n">{N(n.inmMun.get(normTxt(x.municipio))?.size ?? 0)}</td></tr>
                  ))}</tbody>
                </table></div>
                {n.lista.length > 400 && <p className="d-mut">Se muestran 400 de {N(n.lista.length)}; usa la búsqueda para acotar.</p>}
                <p className="d-mut">Fuente: <a href={of.nodos.fuente} target="_blank" rel="noreferrer">CENACE, Catálogo de NodosP del Sistema Eléctrico Nacional</a>, versión {of.nodos.version}.</p>
              </div>
              {n.sinNodo.length > 0 && <div className="d-card w12"><h2>Municipios sin NodoP en el catálogo</h2><p className="d-mut">{n.sinNodo.join(" · ")}</p></div>}
            </>}
          </div>
        )}

      </main>
    </div>
  );
}
