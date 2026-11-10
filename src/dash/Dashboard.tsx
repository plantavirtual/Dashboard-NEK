import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./dashboard.css";
import { useStore } from "../store";
import { TARIFA_COLORS } from "../lib/constants";
import { ANIO_DESDE, FACTOR_ATIPICO, GRUPO_BT, normTarifa, FC_DEFECTO, LIMITE_DOMESTICA_KW, MIN_MUESTRA, PDBT_MAX_KW, PRECIO_MAX, PRECIO_MIN, RESPALDO_CONSUMO, TAR_DEMANDA, buildRows, kwPorConsumo, limiteKw, normTxt, referenciaFc, type Row } from "./rows";
import { COLS_CARGO, FACTOR_CARGA, IVA, PERFIL_HORARIO, aplicarOficial, cargarOficial, type Oficial } from "./tarifas";

type Cfg = any;
type Tab = "pg" | "dm" | "pc" | "np" | "vm";
type GK = "tar" | "zona" | "nodo" | "dep" | "mun";

const M = (n: number) => "$" + (n / 1e6).toLocaleString("es-MX", { maximumFractionDigits: 2 }) + " M";
const N = (n: number) => Math.round(n).toLocaleString("es-MX");
const P = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const KW = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 1 }) + " kW";
const PCT = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "0.0") + " %";
const FECHA = (s: string) => { const d = new Date(s); return isNaN(+d) ? s : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }); };

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
const porNombre = (t: string, pal: string[]) => { let h = 0; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return pal[h % pal.length]; };
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
const tot: Num = (r) => r.total, kwh: Num = (r) => r.kwh, kwc: Num = (r) => r.kwhCosto;
const sum = (a: Row[], f: Num) => { let s = 0; for (const r of a) s += f(r); return s; };
/** Demanda máxima válida (descarta PDBT > 25 kW) */
const maxKw = (a: Row[]) => { let m = 0; for (const r of a) if (r.kwOk && r.kw > m) m = r.kw; return m; };
const by = (R: Row[], f: (r: Row) => string) => {
  const m = new Map<string, Row[]>();
  for (const r of R) { const k = f(r), l = m.get(k); if (l) l.push(r); else m.set(k, [r]); }
  return m;
};
const keys = (m: Map<string, unknown>) => [...m.keys()].sort();
/** $/kWh: solo con los recibos que tienen costo (recibo o tarifa CFE) */
const unit = (a: Row[]) => { const q = sum(a, kwc); return q ? sum(a, tot) / q : 0; };
const distinct = (a: Row[], f: (r: Row) => string | number) => new Set(a.map(f)).size;
/** Recibos = RPU distintos (cada fila es un mes del historial de un recibo) */
const nRec = (a: Row[]) => distinct(a, (r) => r.rpu);
/** Agrega los periodos de cada RPU en una fila por recibo */
const porRecibo = (a: Row[]) => [...by(a, (r) => r.rpu)].map(([rpu, x]) => {
  const pers = x.map((r) => r.per).sort();
  return { rpu, r: x[0], n: x.length, desde: pers[0], hasta: pers[pers.length - 1], kwh: sum(x, kwh), kwMax: Math.max(0, ...x.map((r) => r.kw)),
    total: sum(x, tot), cfe: x.some((r) => r.src === "cfe"), exc: x.filter((r) => r.kw > PDBT_MAX_KW).length };
});
/** Suma de la demanda máxima de cada recibo (RPU) en el periodo: la demanda se mide por servicio */
const sumMaxInm = (a: Row[]) => {
  const m = new Map<string, number>();
  for (const r of a) if (r.kwOk) m.set(r.rpu, Math.max(m.get(r.rpu) ?? 0, r.kw));
  let s = 0; for (const v of m.values()) s += v; return s;
};
const XT = { ticks: { maxTicksLimit: 12 } };
/** Σ por RPU del valor mensual: primero el máximo de cada RPU en el mes, luego la suma */
const sumRpuMes = (a: Row[], f: (r: Row) => number) => { const m = new Map<string, number>(); for (const r of a) m.set(r.rpu, Math.max(m.get(r.rpu) ?? 0, f(r))); let s = 0; for (const v of m.values()) s += v; return s; };

/** Consumo (línea) al frente y costo (barras) atrás: en Chart.js el dataset con menor «order» se dibuja encima */
const barLine = (labels: string[], costo: number[], gwh: number[], c: string[], et = ["Costo ($ M)", "Consumo (GWh)", "$ millones", "GWh"]): Cfg => ({
  type: "bar",
  data: { labels, datasets: [
    { type: "line", label: et[1], data: gwh, borderColor: c[1], backgroundColor: c[1], borderWidth: 2.5, pointRadius: 2, tension: 0.3, yAxisID: "y2", order: 1 },
    { type: "bar", label: et[0], data: costo, backgroundColor: c[0], yAxisID: "y", order: 2 }] },
  options: { interaction: { mode: "index", intersect: false }, scales: { x: XT, y: { title: { display: true, text: et[2] } }, y2: { position: "right", grid: { display: false }, title: { display: true, text: et[3] } } } }
});
/** Dona de costo; con colorDe, cada etiqueta conserva su color fijo (tarifas) */
const dona = (m: Map<string, Row[]>, c: string[] | ((k: string) => string), card: string): Cfg => ({
  type: "doughnut",
  data: { labels: [...m.keys()], datasets: [{ data: [...m.values()].map((a) => sum(a, tot)), backgroundColor: typeof c === "function" ? [...m.keys()].map(c) : c, borderColor: card }] },
  options: { plugins: { tooltip: { callbacks: { label: (x: any) => x.label + ": " + M(x.raw) } } } }
});

function ChartCanvas({ config, theme, tall, alto }: { config: Cfg; theme: Theme; tall?: boolean; alto?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const pal = PAL[theme];
    Chart.defaults.color = pal.mut; Chart.defaults.borderColor = pal.bd;
    Chart.defaults.font.family = '"IBM Plex Sans",system-ui,sans-serif';
    const ch = new Chart(ref.current!, { ...config, options: { responsive: true, maintainAspectRatio: false, ...(config.options ?? {}) } });
    return () => ch.destroy();
  }, [config, theme]);
  return <div className="d-ch" style={alto ? { height: alto } : tall ? { height: 340 } : undefined}><canvas ref={ref} /></div>;
}

/* ── Datos extremos: modos de visualización por gráfica ── */
type Modo = "normal" | "log" | "pct" | "sep" | "clip";
const ETQ_MODO: Record<Modo, string> = { normal: "Normal", log: "Escala log", pct: "100 %", sep: "Separado", clip: "Recortar extremos" };
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
  const logEje = (k: string) => { sc[k] = { ...(sc[k] ?? {}), type: "logarithmic", ticks: { ...(sc[k]?.ticks ?? {}), ...ticksLog } }; };
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
    plugins.tooltip = { ...(plugins.tooltip ?? {}), callbacks: { label: (y: any) => `${y.dataset.label}: ${Number(y.raw).toFixed(1)} % (${compacto(Number(y.dataset.orig[y.dataIndex]) || 0)})`, footer: () => "" } };
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
const barrasH = (pares: [string, number][], colorDe: (k: string) => string, fmt: (x: number) => string, etiqueta: string): Cfg => {
  const a = pares.filter((x) => x[1] > 0).sort((x, y) => y[1] - x[1]), tot = a.reduce((s2, x) => s2 + x[1], 0);
  return { type: "bar", data: { labels: a.map((x) => x[0]), datasets: [{ label: etiqueta, data: a.map((x) => x[1]), backgroundColor: a.map((x) => colorDe(x[0])) }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (y: any) => `${fmt(Number(y.raw))} (${PCT(Number(y.raw), tot)})` } } } } };
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
/** Sección de texto de la pestaña de metodología */
const Sec = ({ t, children, w = "w12" }: { t: string; children: any; w?: string }) => <div className={"d-card " + w}><h2>{t}</h2><div className="d-txt">{children}</div></div>;
const Kpis = ({ items, id }: { items: [string, string | number][]; id?: string }) => (
  <section className="d-kpis" id={id}>{items.map(([a, b]) => <div className="d-kpi" key={a}><span>{a}</span><b>{b}</b></div>)}</section>
);
const Falta = ({ que, cmd }: { que: string; cmd: string }) => (
  <div className="d-card w12"><h2>Sin {que}</h2><p className="d-mut">Genera el archivo con <code>{cmd}</code> y vuelve a cargar la página.</p></div>
);

const ORIGEN: Record<Row["src"], string> = { recibo: "Importe del recibo", precio: "kWh × precio impreso", cfe: "Tabla CFE", none: "Sin costo" };
/** Registro de cambios que se muestra en «Validación y metodología» */
const CAMBIOS: [string, string, string, string][] = [
  ["Conteo de recibos", "Cada fila del historial contaba como un recibo.", "Un recibo es un RPU único; las filas son los meses de su historial.", "Cada archivo de CFE corresponde a un RPU y trae varios meses."],
  ["Meses repetidos", "Se sumaban dos veces.", "Un RPU con el mismo mes dos veces cuenta una sola.", "Evita duplicar consumo y gasto cuando se traslapan historiales."],
  ["Costo sin importe", "Los recibos formato 1 (sin importe) quedaban sin costo.", "Se costean con kWh × precio impreso.", "En la muestra revisada eran el 95 % del consumo; el gasto salía en ~$2.7 M en vez de ~$35.5 M."],
  ["Costo GDMTH", "Solo con el importe del recibo.", "Con la tabla oficial de CFE de su nodo y mes.", "Calcular a partir de la información oficial, por nodo."],
  ["Validación de demanda", "Los kW se usaban tal como venían.", "Valores de 3× o más su mediana sin respaldo del consumo, en cero o imposibles se reemplazan con la media del RPU.", "Errores de captura como 36,707 kW distorsionaban la demanda máxima."],
  ["Demanda PDBT", "Demanda media simple (kWh / 24 · días) o lectura del recibo.", "Estimada con el factor de carga de servicios medidos similares, máx. 25 kW.", "PDBT no mide demanda y la media simple la subestimaba."],
  ["Indicador superior de demanda", "Demanda máxima de GDMTH/GDMTO.", "Demanda general aproximada de todas las tarifas (mes pico).", "Dar una cifra de demanda de toda la base."],
  ["Recuadros superiores", "Siempre los mismos.", "Cambian según la pestaña.", "Mostrar los indicadores de lo que se está viendo."],
  ["Demanda general (General)", "Incluía la línea de «máximo permitido» y un selector de escenario.", "Solo la demanda estimada/medida, apilada por tarifa.", "La proyección al máximo queda en la pestaña Demanda."],
  ["Mes pico por tarifa", "Dona con la demanda del mes pico.", "Porcentaje de recibos de cada tarifa en la base.", "Ver la composición de la base de datos."],
  ["Costo unitario por tarifa", "Incluía costos calculados o estimados.", "Solo importe o precio impreso; las tarifas sin datos no aparecen.", "Aún no hay forma de confirmar los costos estimados."],
  ["Demanda agregada GDMTH/GDMTO", "Barras por tarifa y líneas de máximo individual.", "Una sola serie con la demanda agregada de todas las tarifas.", "Lectura más simple."],
  ["Demanda máxima individual", "Una tarjeta por tarifa.", "Una tarjeta con selector de tarifa (General por defecto).", "Comparar cualquier tarifa en el mismo lugar."],
  ["PDBT contra el límite", "Demanda máxima registrada.", "Demanda estimada (máxima y promedio por recibo).", "PDBT no trae lecturas confiables de kW."],
  ["Pestaña Tarifas CFE", "Pestaña con gráficas de tarifas.", "Eliminada; sus bases están en esta sección.", "Concentrar la explicación de los cálculos."],
  ["Gráfica de costo y consumo", "Barras de costo encima de la línea de consumo.", "Consumo al frente, costo atrás.", "Legibilidad."],
  ["Domésticas con PDBT", "Las tarifas 1, 1A–1F y DAC aparecían por separado.", "Se muestran en un solo grupo «PDBT y domésticas»; los cálculos siguen usando la tarifa real.", "Son pocas, no miden demanda y se tratan igual que PDBT."],
  ["Colores por tarifa", "El color dependía del orden de las tarifas en el filtro y cambiaba.", "Cada tarifa tiene un color fijo en todo el tablero (el mismo del mapa cuando existe).", "Facilitar la lectura y el seguimiento entre gráficas."],
  ["Informe por gráfica", "La explicación estaba en notas debajo de algunas gráficas.", "Cada gráfica tiene un botón «Informe» con qué muestra y cómo se calcula.", "Tener el cálculo a la mano sin saturar las tarjetas."],
  ["Costo y consumo por año", "Gráfica en la pestaña General.", "Eliminada.", "Se pidió quitarla del tablero."],
  ["Datos extremos", "Un grupo grande aplastaba a los chicos; las donas escondían segmentos pequeños.", "Selector por gráfica: escala log, 100 %, separado o recortar picos. Las barras apiladas arrancan en Normal; los comparativos arrancan en log si alguna barra mide menos del 3 % de la mayor; los picos de más de 3× la mediana se recortan. Las donas pasaron a barras ordenadas con % del total.", "Que todos los datos se distingan."],
  ["Colores por zona y zona de carga", "Los colores de zona dependían del filtro; municipios y zonas de carga iban en un solo color.", "Cada zona y cada zona de carga tienen un color fijo en todo el tablero; cada municipio usa el color de su zona.", "Seguir una misma zona entre gráficas y tablas."],
  ["Catálogo NodosP", "No existía.", "Pestaña con el catálogo del CENACE y resumen por zona de carga.", "Ligar los inmuebles a su nodo y zona de carga."]
];
const TABS: [Tab, string][] = [["pg", "General"], ["dm", "Demanda"], ["pc", "Zonas"], ["np", "Catálogo NodosP"], ["vm", "Validación y metodología"]];
const GKS: [GK, string][] = [["tar", "Tarifa"], ["zona", "Zona"], ["nodo", "Zona de carga (NodoP)"], ["dep", "Dependencia"], ["mun", "Municipio"]];

export function Dashboard({ onBack }: { onBack: () => void }) {
  const model = useStore((s) => s.model);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [tab, setTab] = useState<Tab>("pg");
  const [f, setF] = useState({ dep: "", tar: "", mun: "", nodo: "" });
  const [zonaSel, setZonaSel] = useState("");
  const [gk, setGk] = useState<GK>("tar");
  const [tsel, setTsel] = useState("");   // demanda máxima individual: "" = general
  const [q, setQ] = useState(""); const [zc, setZc] = useState("");
  const [of, setOf] = useState<Oficial | null>(null);
  const zonaRef = useRef<HTMLSelectElement>(null);

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
    const zona = (n2: string) => { const i = zonas.indexOf(n2); return n2 === "Sin zona" ? GRIS : i >= 0 ? PAL_ZONA[i % PAL_ZONA.length] : porNombre(n2, PAL_ZONA); };
    const zc = (n2: string) => { const i = zcs.indexOf(n2); return n2 === "Sin nodo" ? GRIS : i >= 0 ? PAL_ZC[i % PAL_ZC.length] : porNombre(n2, PAL_ZC); };
    const mun = (n2: string) => zona(munZona.get(n2) ?? "Sin zona");
    return { zona, zc, mun, zonas: zonas.filter((x) => rows.some((r) => r.zona === x)) };
  }, [model, of, rows]);
  /** Color del grupo según el agrupamiento elegido en Demanda */
  const colorGrupo = (k: string) => (gk === "tar" ? colorTar(k) : gk === "zona" ? colores.zona(k) : gk === "nodo" ? colores.zc(k) : gk === "mun" ? colores.mun(k) : "");
  const Punto = ({ c }: { c: string }) => <span className="d-dot" style={{ background: c }} aria-hidden="true" />;
  const opts = useMemo(() => {
    const u = (g: (r: Row) => string) => [...new Set(rows.map(g))].sort();
    return { dep: u((r) => r.dep), tar: u((r) => r.tar).sort(ordTar), mun: u((r) => r.mun), nodo: u((r) => r.nodo) };
  }, [rows]);

  const R = useMemo(() => rows.filter((r) =>
    (!f.dep || r.dep === f.dep) && (!f.tar || r.tar === f.tar) && (!f.mun || r.mun === f.mun) && (!f.nodo || r.nodo === f.nodo)), [rows, f]);

  /* ── General y zonas ── */
  const v = useMemo(() => {
    const c = PAL[theme].c, card = PAL[theme].card;
    const pm = by(R, (r) => r.per), mons = keys(pm);
    const ta = by(R, (r) => r.tar), tm = by(R, (r) => r.tar + "|" + r.per);
        const ca = by(R, (r) => r.zona), cn = keys(ca), zm = by(R, (r) => r.zona + "|" + r.per);
    const ma = [...by(R, (r) => r.mun)].map(([k, a]) => [k, sum(a, tot)] as [string, number]).sort((a, b) => b[1] - a[1]);
    const da = [...by(R, (r) => r.dep)].map(([k, a]) => [k, sum(a, tot)] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const top = porRecibo(R).sort((a, b) => b.total - a.total).slice(0, 10);
    const g = (m: Map<string, Row[]>, k: string) => m.get(k) ?? [];
    const tarsAll = [...ta.keys()].sort(ordTar), col = colorTar;
    /** $/kWh solo con datos del recibo (importe o precio impreso); sin estimaciones */
    const real = (a: Row[]) => { let s = 0, q2 = 0; for (const r of a) if (Number.isFinite(r.fact) && r.kwh > 0) { s += r.fact; q2 += r.kwh; } return q2 ? s / q2 : null; };
    const tarsReal = tarsAll.filter((t) => real(g(ta, t)) !== null);

    // Demanda general aproximada: en cada mes, Σ de la demanda (medida o estimada) de cada RPU; se reporta el mes más alto
    const dMes = mons.map((k) => sumRpuMes(g(pm, k), (r) => r.kwEst));
    const iPico = dMes.reduce((b, y, i) => (y > dMes[b] ? i : b), 0);
    const rpuTar = tarsAll.map((t) => nRec(g(ta, t))), nR = nRec(R);

    const charts: Record<string, Cfg> = {
      cG: { type: "bar", data: { labels: mons, datasets: tarsAll.map((t) => ({ label: t, stack: "s", backgroundColor: col(t),
        data: mons.map((k) => sumRpuMes(g(tm, t + "|" + k), (r) => r.kwEst)) })) },
        options: { interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { label: (y: any) => `${y.dataset.label}: ${KW(y.raw ?? 0)}`,
          footer: (it: any[]) => "Total: " + KW(it.reduce((s2, y) => s2 + (y.raw ?? 0), 0)) } } },
          scales: { x: { stacked: true, ...XT }, y: { stacked: true, title: { display: true, text: "kW (Σ de la demanda de cada RPU)" } } } } },
      cP: barrasH(tarsAll.map((t, k) => [t, rpuTar[k]] as [string, number]), colorTar, (x) => N(x) + " recibos", "Recibos (RPU)"),
      c1: barLine(mons, mons.map((k) => sum(g(pm, k), tot) / 1e6), mons.map((k) => sum(g(pm, k), kwh) / 1e6), c),
      c2: barrasH(tarsAll.map((t) => [t, sum(g(ta, t), tot)] as [string, number]), colorTar, M, "Costo"),
      c3: { type: "line", data: { labels: mons, datasets: tarsReal.map((t) => ({ label: t, borderColor: col(t), backgroundColor: col(t), pointRadius: 0, tension: 0.3, spanGaps: true,
        data: mons.map((k) => real(g(tm, t + "|" + k))) })) },
        options: { scales: { x: XT, y: { title: { display: true, text: "$/kWh" } } } } },
      c6: { type: "bar", data: { labels: ma.map((y) => y[0]), datasets: [{ label: "Costo ($ M)", data: ma.map((y) => y[1] / 1e6), backgroundColor: ma.map((y) => colores.mun(y[0])) }] }, options: { indexAxis: "y", plugins: { legend: { display: false } } } },
      c7: { type: "bar", data: { labels: da.map((y) => y[0]), datasets: [{ label: "Costo ($ M)", data: da.map((y) => y[1] / 1e6), backgroundColor: c[2] }] }, options: { indexAxis: "y", plugins: { legend: { display: false } } } },
      c8: { type: "bar", data: { labels: mons, datasets: cn.map((z2) => ({ label: z2, backgroundColor: colores.zona(z2), data: mons.map((k) => sum(g(zm, z2 + "|" + k), tot) / 1e6) })) },
        options: { scales: { x: { stacked: true, ...XT }, y: { stacked: true, title: { display: true, text: "$ millones" } } } } },
      c9: { type: "bar", data: { labels: cn, datasets: [{ label: "$/kWh", data: cn.map((z2) => unit(g(ca, z2))), backgroundColor: cn.map(colores.zona) }] }, options: { plugins: { legend: { display: false } }, scales: { y: { title: { display: true, text: "$/kWh" } } } } }
    };
    const conCosto = R.filter((r) => r.src !== "none").length, kCosto = sum(R, kwc);
    const orig = (["recibo", "precio", "cfe", "none"] as Row["src"][]).map((k) => { const a = R.filter((r) => r.src === k); return { k, n: a.length, kwh: sum(a, kwh), g: sum(a, tot) }; });
    const atip = R.filter((r) => r.atipico).sort((a, b) => b.fact / (b.kwh || 1) - a.fact / (a.kwh || 1));
    const zTop = [...ca].map(([k, a]) => [k, sum(a, tot)] as [string, number]).sort((a, b) => b[1] - a[1])[0];
    return { dGen: dMes[iPico] ?? 0, dGenMes: mons[iPico] ?? "—", T: sum(R, tot), K: sum(R, kwh), charts, ca, cn, top, conCosto, kCosto, orig, atip, zTop,
      sinReal: tarsAll.filter((t) => !tarsReal.includes(t)), tarsAll, col };
  }, [R, theme, colores]);

  /* ── Demanda ── */
  const d = useMemo(() => {
    const c = PAL[theme].c, col = v.col;
    const am = by(R, (r) => r.per), ams = keys(am);
    // Misma gráfica que en General (demanda por tarifa) más la línea del total con PDBT y domésticas a su máximo permitido
    const ch1: Cfg = { ...v.charts.cG, data: { ...v.charts.cG.data, datasets: [
      { type: "line", label: "Total si PDBT y domésticas usaran su máximo permitido", order: 1,
        data: ams.map((k) => sumRpuMes(am.get(k)!, (r) => limiteKw(r.tarCFE) || r.kwEst)),
        borderColor: PAL[theme].mut, backgroundColor: PAL[theme].mut, borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: 0.2 },
      ...v.charts.cG.data.datasets.map((x: any) => ({ ...x, type: "bar", order: 2 }))] },
      options: { ...v.charts.cG.options, plugins: { tooltip: { callbacks: { label: (y: any) => `${y.dataset.label}: ${KW(y.raw ?? 0)}`,
        footer: (it: any[]) => "Total estimado: " + KW(it.filter((y) => y.dataset.type !== "line").reduce((s2, y) => s2 + (y.raw ?? 0), 0)) } } } } };

    // Demanda máxima individual: un RPU; medida si la trae, estimada si no
    const pool = (tsel ? R.filter((r) => r.tar === tsel) : R).filter((r) => r.kwEst > 0);
    const porR = [...by(pool, (r) => r.rpu)].map(([rpu, a]) => { const m = a.reduce((b, r) => (r.kwEst > b.kwEst ? r : b), a[0]); return { rpu, m, n: a.length, med: a.some((r) => r.kwSrc === "medida") }; })
      .sort((a, b) => b.m.kwEst - a.m.kwEst);
    const indiv = { max: porR[0]?.m.kwEst ?? 0, pico: porR[0]?.m ?? null, prom: porR.length ? porR.reduce((s2, x) => s2 + x.m.kwEst, 0) / porR.length : 0, n: porR.length,
      medidos: porR.filter((x) => x.med).length, top: porR.slice(0, 10) };

    const D = R.filter((r) => TAR_DEMANDA.includes(r.tar) && r.kwOk);
    const gf: Record<GK, (r: Row) => string> = { tar: (r) => r.tar, zona: (r) => r.zona, nodo: (r) => r.nodo, dep: (r) => r.dep, mun: (r) => r.mun };
    const grupos = [...by(R.filter((r) => r.kwEst > 0), gf[gk])].map(([k, a]) => {
      const mes = new Map<string, Row[]>(); for (const r of a) { const l = mes.get(r.per); if (l) l.push(r); else mes.set(r.per, [r]); }
      const horas = sum(a.filter((r) => r.kwSrc === "medida"), (r) => r.kw * 24 * r.dias);
      return { k, n: distinct(a, (r) => r.i), rec: nRec(a), kwMax: Math.max(0, ...a.map((r) => r.kwEst)), pico: Math.max(0, ...[...mes.values()].map((l) => sumRpuMes(l, (r) => r.kwEst))),
        est: PCT(a.filter((r) => r.kwSrc === "estimada").length, a.length), fc: horas ? sum(a.filter((r) => r.kwSrc === "medida"), kwh) / horas : 0,
        cDem: sum(a, (r) => (r.partes ? r.partes.distribucion + r.partes.capacidad : 0)), tars: [...new Set(a.map((r) => r.tar))].sort(ordTar).join(", ") };
    }).sort((x, y) => y.pico - x.pico);
    const g15 = grupos.slice(0, 15);
    const ch2: Cfg = { type: "bar", data: { labels: g15.map((x) => x.k), datasets: [{ label: "Pico mensual agregado (kW)", data: g15.map((x) => x.pico), backgroundColor: g15.map((x) => (gk === "tar" ? colorTar(x.k) : gk === "zona" ? colores.zona(x.k) : gk === "nodo" ? colores.zc(x.k) : gk === "mun" ? colores.mun(x.k) : c[0])) }] },
      options: { indexAxis: "y", plugins: { legend: { display: false } } } };

    const PD = R.filter((r) => r.tar === GRUPO_BT), ppm = by(PD, (r) => r.per), pms = keys(ppm);
    const ch3: Cfg = { type: "bar", data: { labels: pms, datasets: [
      { type: "line", label: `Límite PDBT (${PDBT_MAX_KW} kW)`, data: pms.map(() => PDBT_MAX_KW), borderColor: c[0], borderDash: [6, 4], borderWidth: 2, pointRadius: 0, order: 1 },
      { type: "line", label: "Promedio estimado por recibo (kW)", data: pms.map((k) => { const a = ppm.get(k)!; return a.length ? sum(a, (r) => r.kwEst) / a.length : 0; }), borderColor: c[2], backgroundColor: c[2], borderWidth: 2, pointRadius: 2, tension: 0.3, order: 1 },
      { type: "bar", label: "Demanda estimada máxima (kW)", data: pms.map((k) => Math.max(0, ...ppm.get(k)!.map((r) => r.kwEst))), backgroundColor: colorTar(GRUPO_BT), order: 2 }] },
      options: { interaction: { mode: "index", intersect: false }, scales: { x: XT, y: { title: { display: true, text: "kW" } } } } };
    const exc = porRecibo(PD.filter((r) => r.kwOrig > limiteKw(r.tarCFE)).map((r) => ({ ...r, kw: r.kwOrig }))).sort((a, b) => b.kwMax - a.kwMax);

    /* Proyección PDBT y domésticas al máximo permitido */
    const L = R.filter((r) => limiteKw(r.tarCFE) > 0), lm = by(L, (r) => r.per), lms = keys(lm), lt = [...new Set(L.map((r) => r.tar))].sort(ordTar), ltm = by(L, (r) => r.tar + "|" + r.per);
    const chL: Cfg = { type: "bar", data: { labels: lms, datasets: [
      { type: "line", label: "Proyección: todos al máximo permitido", data: lms.map((k) => sumRpuMes(lm.get(k)!, (r) => limiteKw(r.tarCFE))), borderColor: c[0], backgroundColor: c[0], borderWidth: 2.5, pointRadius: 2, tension: 0.2, order: 1 },
      ...lt.map((t) => ({ type: "bar", label: `${t} · estimada`, stack: "s", backgroundColor: col(t), order: 2, data: lms.map((k) => sumRpuMes(ltm.get(t + "|" + k) ?? [], (r) => r.kwEst)) }))] },
      options: { interaction: { mode: "index", intersect: false }, scales: { x: { stacked: true, ...XT }, y: { stacked: true, title: { display: true, text: "kW" } } } } };
    const proy = [...by(L, gf[gk])].map(([k, a]) => {
      const est = sumRpuMes(a, (r) => r.kwEst), pot = sumRpuMes(a, (r) => limiteKw(r.tarCFE));
      return { k, tars: [...new Set(a.map((r) => r.tar))].sort(ordTar).join(", "), n: nRec(a), est, pot, hol: pot - est, uso: pot ? est / pot : 0 };
    }).sort((y, z2) => z2.pot - y.pot);
    const Lest = sumRpuMes(L, (r) => r.kwEst), Lpot = sumRpuMes(L, (r) => limiteKw(r.tarCFE));

    const conKw = R.filter((r) => r.hasKw), fix = conKw.filter((r) => r.kwFix);
    const motivos = [...by(fix, (r) => r.kwFix.replace(/ · .*/, "").replace(/^[\d.,]+ veces su mediana.*/, `${FACTOR_ATIPICO}× o más su mediana sin respaldo del consumo`))]
      .map(([k, a]) => ({ k, n: a.length, rep: a.filter((r) => r.kwOk).length, rpu: nRec(a) })).sort((a, b) => b.n - a.n);
    const val = { meses: conKw.length, rpu: nRec(conKw), fix: fix.sort((a, b) => Math.abs(b.kwOrig - b.kw) - Math.abs(a.kwOrig - a.kw)), motivos,
      corr: fix.filter((r) => r.kwOk).length, desc: fix.filter((r) => !r.kwOk).length };
    const ref = referenciaFc(R), E = R.filter((r) => r.kwSrc === "estimada"), em = by(E, (r) => r.per), ems = keys(em);
    const pk = (fn: (r: Row) => number) => Math.max(0, ...ems.map((k) => sumRpuMes(em.get(k)!, fn)));
    const est = { ref, n: nRec(E), meses: E.length, pico: pk((r) => r.kwEst), bajo: pk((r) => kwPorConsumo(r, ref.fcAlto)), alto: pk((r) => kwPorConsumo(r, ref.fcBajo)),
      tar: [...new Set(E.map((r) => r.tar))].sort(ordTar).join(", ") };
    return { ch1, ch2, ch3, chL, indiv, grupos, D, PD, exc, L, Lest, Lpot, proy, val, est, medidos: nRec(R.filter((r) => r.kwSrc === "medida")) };
  }, [R, theme, gk, tsel, v, colores]);

  /* ── Bases de tarifas CFE (para la pestaña de metodología) ── */
  const t = useMemo(() => {
    const G = R.filter((r) => r.tar === "GDMTH" && Number.isFinite(r.fact) && r.partes);
    const vig = Object.entries(of?.tar?.tarifas ?? {}).flatMap(([tar, o]) => o.grupos.map((g) => {
      const ms = Object.keys(g.meses).sort(), ult = ms[ms.length - 1] ?? "";
      return { tar, g, ult, c: g.meses[ult] ?? {} };
    })).sort((a, b) => ordTar(a.tar, b.tar) || a.g.division.localeCompare(b.g.division));
    return { vig, cols: COLS_CARGO.filter(([k]) => vig.some((x) => x.c[k])), fact: sum(G, (r) => r.fact), calc: sum(G, (r) => r.calc), nG: G.length };
  }, [R, of]);

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
        inm: distinct(a, (r) => r.i), kwh: sum(a, kwh), gasto: sum(a, tot), u: unit(a), dem: sumMaxInm(a.filter((r) => TAR_DEMANDA.includes(r.tar))) };
    });
    const conInm = res.filter((x) => x.inm);
    const ch: Cfg = barLine(conInm.map((x) => x.z), conInm.map((x) => x.gasto / 1e6), conInm.map((x) => x.kwh / 1e6), c);
    ch.data.datasets[1].backgroundColor = conInm.map((x) => colores.zc(x.z));
    const sinNodo = [...new Set(R.filter((r) => r.nodo === "Sin nodo").map((r) => r.mun))].sort();
    return { nodos, zcs, lista, res, ch, sinNodo, inmMun, muns: new Set(nodos.map((x) => normTxt(x.municipio))).size };
  }, [of, R, q, zc, theme, colores]);

  // Detalle de zona
  const zona = v.cn.includes(zonaSel) ? zonaSel : v.cn[0] ?? "";
  const z = useMemo(() => {
    const cs = v.ca.get(zona) ?? [], c = PAL[theme].c;
    const cm = by(cs, (r) => r.per), cls = keys(cm);
    const d1 = barLine(cls, cls.map((k) => sum(cm.get(k)!, tot) / 1e6), cls.map((k) => sum(cm.get(k)!, kwh) / 1e6), [colores.zona(zona), c[1]]);
    const d2 = barrasH([...by(cs, (r) => r.tar)].map(([t, a]) => [t, sum(a, tot)] as [string, number]), colorTar, M, "Costo");
    const deps = [...by(cs, (r) => r.dep)].map(([dd, a]) => ({ d: dd, a, t: sum(a, tot) })).sort((x, y) => y.t - x.t);
    return { cs, d1, d2, deps };
  }, [v, zona, theme, colores]);

  const toggleTheme = () => { const nt = theme === "dark" ? "light" : "dark"; setTheme(nt); try { localStorage.setItem("tema", nt); } catch { /* sin storage */ } };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  if (!model) return <div className="dash" data-theme={theme}><main><h1>Recibos de CFE</h1><p className="d-sub">Cargando…</p></main></div>;

  const { T, K } = v;
  const periodo = rows.length ? `${rows.reduce((m, r) => (r.per < m ? r.per : m), rows[0].per)} a ${rows.reduce((m, r) => (r.per > m ? r.per : m), rows[0].per)}` : "";
  const costoProm = v.kCosto ? T / v.kCosto : 0;
  const zT = sum(z.cs, tot), zK = sum(z.cs, kwh);
  const dif = t.fact ? ((t.calc - t.fact) / t.fact) * 100 : 0;
  const ref = d.est.ref;
  const FUENTES_COSTO = <ul>
    <li><b>Importe del recibo</b> cuando lo trae (formato 2).</li>
    <li><b>kWh × precio impreso</b> cuando no trae importe (formato 1).</li>
    <li><b>Tabla oficial de CFE</b> de su nodo y mes cuando no hay ni importe ni precio. GDMTH siempre se costea con la tabla de CFE.</li>
  </ul>;
  const DEM_RECIBO = <ul>
    <li><b>Con lectura de kW:</b> la lectura del recibo después de la validación (pestaña Demanda, última tarjeta).</li>
    <li><b>Sin lectura</b> ({GRUPO_BT} y meses sin dato): kWh del mes / (24 · días · FC), con FC = {ref.fc.toFixed(3)} sacado de {N(ref.n)} {ref.origen}. En {GRUPO_BT} nunca pasa de {PDBT_MAX_KW} kW.</li>
  </ul>;
  const INF = {
    cG: <><p><b>Qué muestra:</b> la demanda de toda la base, mes por mes, y cuánto aporta cada tarifa.</p>
      <p><b>Cálculo:</b> para cada mes se toma la demanda de cada recibo (RPU) y se suma por tarifa:</p>{DEM_RECIBO}
      <p>La altura total de la barra es la <b>demanda general aproximada</b> del mes. El mes más alto del filtro es {v.dGenMes}, con {KW(v.dGen)}.</p>
      <p><b>Consideración:</b> es una suma no coincidente: cada recibo alcanza su máximo en distinto día y hora, así que la demanda simultánea real es menor.</p></>,
    cP: <><p><b>Qué muestra:</b> qué parte de la base es de cada tarifa.</p>
      <p><b>Cálculo:</b> recibos (RPU) de la tarifa / recibos totales del filtro ({N(nRec(R))}). La tarifa es la del inmueble en Supabase; las domésticas (1, 1A–1F, DAC) se cuentan dentro de «{GRUPO_BT}».</p></>,
    c1: <><p><b>Qué muestra:</b> el gasto mensual (barras, atrás) y el consumo mensual (línea, al frente).</p>
      <p><b>Costo:</b> suma del costo de cada mes de historial, tomado en este orden:</p>{FUENTES_COSTO}
      <p><b>Consumo:</b> suma de kWh, en GWh. En el filtro actual, {PCT(v.kCosto, K)} del consumo tiene costo; los meses sin costo suman consumo pero no gasto.</p></>,
    c2: <><p><b>Qué muestra:</b> cómo se reparte el gasto total entre tarifas.</p><p><b>Cálculo:</b> suma del costo de los meses de cada tarifa, con las mismas fuentes que el costo mensual:</p>{FUENTES_COSTO}</>,
    c3: <><p><b>Qué muestra:</b> cuánto se paga por kWh en cada tarifa, mes a mes.</p>
      <p><b>Cálculo:</b> Σ monto del recibo / Σ kWh, usando solo meses con importe o precio impreso. No incluye costos calculados con la tabla de CFE porque aún no se pueden confirmar.</p>
      {v.sinReal.length > 0 ? <p>Tarifas sin datos del recibo (no aparecen): {v.sinReal.join(", ")}.</p> : null}</>,
    c6: <><p><b>Qué muestra:</b> el gasto total de cada municipio, de mayor a menor. Cada barra tiene el color de la zona a la que pertenece el municipio (leyenda arriba).</p><p><b>Cálculo:</b> suma del costo de los meses de los inmuebles de cada municipio, con las fuentes de costo de siempre.</p>{FUENTES_COSTO}</>,
    c7: <><p><b>Qué muestra:</b> las 10 dependencias con mayor gasto en el filtro.</p><p><b>Cálculo:</b> suma del costo de los meses de los inmuebles de cada dependencia.</p>{FUENTES_COSTO}</>,
    ch1: <><p><b>Qué muestra:</b> la demanda agregada de todas las tarifas por mes (barras apiladas por tarifa) y cuánto sería si {GRUPO_BT} usaran su máximo (línea punteada).</p>
      <p><b>Barras:</b> suma de la demanda de cada recibo en el mes:</p>{DEM_RECIBO}
      <p><b>Línea:</b> la misma suma, pero cada recibo de {GRUPO_BT} cuenta con su máximo permitido ({PDBT_MAX_KW} kW en PDBT; {LIMITE_DOMESTICA_KW} kW en domésticas, supuesto). Las demás tarifas quedan con su demanda.</p>
      <p><b>Consideración:</b> suma no coincidente; la demanda simultánea real es menor.</p></>,
    ch2: <><p><b>Qué muestra:</b> los 15 grupos con mayor pico mensual agregado, según el agrupamiento elegido.</p>
      <ul><li><b>Pico mensual agregado:</b> para cada mes se suma la demanda de los recibos del grupo y se toma el mes más alto.</li>
        <li><b>kW máx. individual:</b> el recibo del grupo con mayor demanda en un mes.</li>
        <li><b>% de meses estimados:</b> meses sin lectura de kW cuya demanda se estimó por consumo.</li>
        <li><b>Factor de carga (medidos):</b> Σ kWh / Σ (kW · 24 · días), solo meses con lectura.</li>
        <li><b>Distribución + capacidad:</b> esos cargos según la tabla de CFE (solo donde hay tabla).</li></ul>{DEM_RECIBO}</>,
    ch3: <><p><b>Qué muestra:</b> la demanda estimada de {GRUPO_BT} frente a su límite de {PDBT_MAX_KW} kW.</p>
      <ul><li><b>Barras:</b> el recibo con mayor demanda estimada en cada mes.</li><li><b>Línea continua:</b> promedio de demanda estimada por recibo.</li><li><b>Línea punteada:</b> el límite de {PDBT_MAX_KW} kW.</li></ul>
      <p><b>Cálculo:</b> estas tarifas no miden demanda: kWh del mes / (24 · días · FC), FC = {ref.fc.toFixed(3)} (rango {ref.fcBajo.toFixed(3)}–{ref.fcAlto.toFixed(3)}), sin pasar de {PDBT_MAX_KW} kW. Si un recibo trae una lectura válida de kW, se usa esa.</p>
      <p><b>Consideración:</b> un recibo con lecturas mayores al límite aparece en la tabla de abajo como posible servicio mal clasificado (debería ser GDBT).</p></>,
    chL: <><p><b>Qué muestra:</b> cuánta demanda tendrían {GRUPO_BT} si todos los recibos llegaran a su máximo permitido, frente a lo estimado hoy.</p>
      <ul><li><b>Barras:</b> suma mensual de la demanda estimada de cada recibo.</li><li><b>Línea:</b> número de recibos del mes × su máximo permitido ({PDBT_MAX_KW} kW en PDBT; {LIMITE_DOMESTICA_KW} kW en domésticas, supuesto porque la tarifa doméstica no fija tope).</li>
        <li><b>Holgura:</b> proyección − estimada. <b>Uso del máximo:</b> estimada / proyección.</li></ul></>,
    c8: <><p><b>Qué muestra:</b> el gasto mensual de cada zona, apilado.</p><p><b>Cálculo:</b> suma del costo de los meses de los inmuebles de cada zona. La zona se asigna por municipio; si el municipio no coincide, por la zona más cercana según coordenadas.</p>{FUENTES_COSTO}</>,
    c9: <><p><b>Qué muestra:</b> el costo promedio por kWh de cada zona.</p><p><b>Cálculo:</b> Σ costo / Σ kWh de los meses con costo. A diferencia del costo unitario por tarifa, aquí sí entran los meses costeados con la tabla de CFE.</p>{FUENTES_COSTO}</>,
    d1: <><p><b>Qué muestra:</b> el gasto (barras, atrás) y el consumo (línea, al frente) mensual de la zona elegida.</p><p><b>Cálculo:</b> suma del costo y de los kWh de los meses de los inmuebles de la zona.</p>{FUENTES_COSTO}</>,
    d2: <><p><b>Qué muestra:</b> cómo se reparte el gasto de la zona entre tarifas, con los mismos colores de tarifa de todo el tablero.</p><p><b>Cálculo:</b> suma del costo de los meses de cada tarifa dentro de la zona.</p>{FUENTES_COSTO}</>,
    nc: <><p><b>Qué muestra:</b> gasto (barras, atrás) y consumo (línea, al frente) por zona de carga del CENACE.</p>
      <p><b>Cálculo:</b> cada inmueble se liga a una zona de carga por el NodoP capturado en el inmueble; si no lo tiene o no está en el catálogo, por su municipio (la zona de carga más frecuente entre los NodosP del municipio). Después se suman costo y kWh.</p>{FUENTES_COSTO}</>
  };

  /* Recuadros bajo los filtros: cambian con la pestaña */
  const KP: Record<Tab, [string, string][]> = {
    pg: [["Gasto total", M(T)], ["Consumo", N(K / 1000) + " MWh"], ["Costo promedio", P(costoProm) + " /kWh"], ["Demanda general aprox. (mes pico)", KW(v.dGen)],
      ["Recibos (RPU)", N(nRec(R))], ["Inmuebles", N(distinct(R, (r) => r.i))]],
    dm: [["Demanda general aprox. (mes pico)", KW(v.dGen)], ["Mes pico", v.dGenMes], ["Demanda máx. individual", KW(d.indiv.max)],
      ["Recibos con kW medido", N(d.medidos)], ["Recibos con demanda estimada", N(d.est.n)], ["Meses de kW corregidos", N(d.val.corr)]],
    pc: [["Zonas", N(v.cn.length)], ["Gasto", M(T)], ["Consumo", N(K / 1000) + " MWh"], ["Costo promedio", P(costoProm) + " /kWh"],
      ["Zona de mayor gasto", v.zTop ? v.zTop[0] : "—"], ["Inmuebles", N(distinct(R, (r) => r.i))]],
    np: of?.nodos ? [["NodosP en Tamaulipas", N(n.nodos.length)], ["Zonas de carga", N(n.zcs.length)], ["Municipios con NodoP", N(n.muns)],
      ["Inmuebles en una zona de carga", N(distinct(R.filter((r) => r.nodo !== "Sin nodo"), (r) => r.i))]] : [],
    vm: [["Meses de historial", N(R.length)], ["Meses con costo", PCT(v.conCosto, R.length)], ["Meses de kW corregidos", N(d.val.corr)],
      ["Recibos con demanda estimada", N(d.est.n)], ["Precios atípicos", N(v.atip.length)], ["Recibos (RPU)", N(nRec(R))]]
  };

  return (
    <div className="dash" data-theme={theme}>
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
            ? <><b>{N(nRec(rows))} recibos (RPU) · {N(rows.length)} meses de historial · {N(model.N)} inmuebles</b> ({periodo}).{" "}</>
            : <><b>Sin historial.</b> Revisa la conexión con Supabase y los permisos de las vistas.{" "}</>}
          {!of ? "Cargando tarifas CFE y NodosP…" : <>
            {of.tar ? <>Tarifas CFE consultadas el {FECHA(of.tar.generado)}. </> : <>Sin tarifas oficiales (<code>node scripts/scrape-tarifas-cfe.mjs</code>). </>}
            {of.nodos ? <>Catálogo NodosP {of.nodos.version}. </> : <>Sin catálogo de NodosP (<code>node scripts/scrape-nodosp-cenace.mjs</code>). </>}
          </>}
          <button className="d-link" type="button" onClick={() => setTab("vm")}>Cómo se calcula →</button>
        </div>

        <div className="d-bar">
          <label>Dependencia<select value={f.dep} onChange={set("dep")}><option value="">Todas las dependencias</option>{opts.dep.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Tarifa<select value={f.tar} onChange={set("tar")}><option value="">Todas las tarifas</option>{opts.tar.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Municipio<select value={f.mun} onChange={set("mun")}><option value="">Todos los municipios</option>{opts.mun.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Zona de carga<select value={f.nodo} onChange={set("nodo")}><option value="">Todas las zonas de carga</option>{opts.nodo.map((x) => <option key={x}>{x}</option>)}</select></label>
          <button className="d-btn" type="button" onClick={() => setF({ dep: "", tar: "", mun: "", nodo: "" })}>Limpiar filtros</button>
        </div>

        {KP[tab].length > 0 && <Kpis items={KP[tab]} />}

        <nav className="d-tabs" role="tablist">
          {TABS.map(([k, l]) => <button key={k} className={"d-tab" + (tab === k ? " on" : "")} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </nav>

        {tab === "pg" && (
          <div className="d-grid">
            <div className="d-card w8"><Cab t="Demanda general por tarifa" info={INF.cG} /><Grafica config={v.charts.cG} theme={theme} tall modos={["pct", "sep"]} /></div>
            <div className="d-card w4"><Cab t="Recibos por tarifa" info={INF.cP} /><Grafica config={v.charts.cP} theme={theme} tall modos={["log"]} /></div>
            <div className="d-card w8"><Cab t="Costo mensual y consumo" info={INF.c1} /><Grafica config={v.charts.c1} theme={theme} modos={["clip"]} /></div>
            <div className="d-card w4"><Cab t="Costo por tarifa" info={INF.c2} /><Grafica config={v.charts.c2} theme={theme} modos={["log"]} /></div>
            <div className="d-card w12"><Cab t="Costo unitario ($/kWh) por tarifa" info={INF.c3} /><Grafica config={v.charts.c3} theme={theme} modos={["clip", "log"]} /></div>
            <div className="d-card w12"><Cab t="Costo por municipio" info={INF.c6} />
              <div className="d-ley">{colores.zonas.map((zz) => <span key={zz}><Punto c={colores.zona(zz)} />{zz}</span>)}</div><Grafica config={v.charts.c6} theme={theme} alto={Math.max(300, (v.charts.c6.data.labels.length || 1) * 20 + 40)} modos={["log"]} /></div>
            <div className="d-card w12"><Cab t="10 mayores gastos por dependencia" info={INF.c7} /><Grafica config={v.charts.c7} theme={theme} modos={["log"]} /></div>
            <div className="d-card w12"><h2>Recibos de mayor gasto en el periodo</h2>
              <div className="d-tw"><table>
                <thead><tr><th>RPU</th><th>Inmueble</th><th>Dependencia</th><th>Municipio</th><th>Tarifa</th><th>Historial</th><th className="n">Meses</th><th className="n">kWh</th><th className="n">kW máx.</th><th className="n">Total</th><th>Origen</th></tr></thead>
                <tbody>{v.top.map((x) => (
                  <tr key={x.rpu}><td>{x.rpu}</td><td>{model.props[x.r.i].nombre}</td><td>{x.r.dep}</td><td>{x.r.mun}</td><td>{x.r.tar}</td><td>{x.desde} a {x.hasta}</td><td className="n">{x.n}</td>
                    <td className="n">{N(x.kwh)}</td><td className="n">{N(x.kwMax)}</td><td className="n">{P(x.total)}</td><td>{x.cfe ? "Tabla CFE" : x.r.src === "precio" ? "Precio impreso" : "Recibo"}</td></tr>
                ))}</tbody>
              </table></div>
            </div>
          </div>
        )}

        {tab === "dm" && (
          <div className="d-grid">
            <div className="d-card w12"><Cab t="Demanda máxima agregada por mes" info={INF.ch1} /><Grafica config={d.ch1} theme={theme} tall modos={["pct", "sep"]} /></div>

            <div className="d-card w12"><h2>Demanda máxima individual</h2>
              <div className="d-bar"><label>Tarifa<select value={tsel} onChange={(e) => setTsel(e.target.value)}><option value="">General (todas las tarifas)</option>
                {v.tarsAll.map((x) => <option key={x}>{x}</option>)}</select></label></div>
              <Kpis items={[["Demanda máx.", KW(d.indiv.max)], ["Promedio de máximos por recibo", KW(d.indiv.prom)], ["Recibos (RPU)", N(d.indiv.n)], ["Con lectura medida", N(d.indiv.medidos)]]} />
              {d.indiv.pico && <p className="d-mut">Pico: RPU {d.indiv.pico.rpu} · {model.props[d.indiv.pico.i].nombre} · {d.indiv.pico.tar} · {d.indiv.pico.per} ({d.indiv.pico.kwSrc}).</p>}
              <div className="d-tw"><table>
                <thead><tr><th>RPU</th><th>Inmueble</th><th>Tarifa</th><th>Municipio</th><th>Mes del pico</th><th className="n">kW máx.</th><th>Fuente</th><th className="n">Meses</th></tr></thead>
                <tbody>{d.indiv.top.map((y) => (
                  <tr key={y.rpu}><td>{y.rpu}</td><td>{model.props[y.m.i].nombre}</td><td>{y.m.tar}</td><td>{y.m.mun}</td><td>{y.m.per}</td><td className="n">{KW(y.m.kwEst)}</td>
                    <td>{y.m.kwSrc === "medida" ? (y.m.kwFix ? "Medida (corregida)" : "Medida") : "Estimada"}</td><td className="n">{y.n}</td></tr>
                ))}</tbody>
              </table></div>
            </div>

            <div className="d-card w12"><Cab t="Demanda agrupada" info={INF.ch2} />
              <div className="d-bar"><label>Agrupar por<select value={gk} onChange={(e) => setGk(e.target.value as GK)}>{GKS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label></div>
              <Grafica config={d.ch2} theme={theme} tall modos={["log"]} />
              <div className="d-tw"><table>
                <thead><tr><th>{GKS.find((x) => x[0] === gk)![1]}</th><th>Tarifas</th><th className="n">Inmuebles</th><th className="n">Recibos (RPU)</th><th className="n">kW máx. individual</th><th className="n">Pico mensual agregado</th><th className="n">% de meses estimados</th><th className="n">Factor de carga (medidos)</th><th className="n">Distribución + capacidad</th></tr></thead>
                <tbody>{d.grupos.map((x) => (
                  <tr key={x.k}><td>{colorGrupo(x.k) && <Punto c={colorGrupo(x.k)} />}{x.k}</td><td>{x.tars}</td><td className="n">{N(x.n)}</td><td className="n">{N(x.rec)}</td><td className="n">{KW(x.kwMax)}</td><td className="n">{KW(x.pico)}</td>
                    <td className="n">{x.est}</td><td className="n">{x.fc ? (x.fc * 100).toFixed(1) + " %" : "—"}</td><td className="n">{x.cDem ? M(x.cDem) : "—"}</td></tr>
                ))}</tbody>
              </table></div>
            </div>

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

            {d.L.length > 0 && <div className="d-card w12"><Cab t={`${GRUPO_BT}: proyección al máximo permitido`} info={INF.chL} />
              <Kpis items={[["Recibos", N(nRec(d.L))], ["Σ demanda estimada", KW(d.Lest)], ["Proyección al máximo permitido", KW(d.Lpot)],
                ["Holgura", KW(d.Lpot - d.Lest)], ["Uso del máximo", PCT(d.Lest, d.Lpot)]]} />
              <Grafica config={d.chL} theme={theme} tall />
              <div className="d-tw"><table>
                <thead><tr><th>{GKS.find((x) => x[0] === gk)![1]}</th><th>Tarifas</th><th className="n">Recibos (RPU)</th><th className="n">Σ estimada</th><th className="n">Proyección al máximo</th><th className="n">Holgura</th><th className="n">Uso del máximo</th></tr></thead>
                <tbody>{d.proy.map((x) => (
                  <tr key={x.k}><td>{colorGrupo(x.k) && <Punto c={colorGrupo(x.k)} />}{x.k}</td><td>{x.tars}</td><td className="n">{N(x.n)}</td><td className="n">{KW(x.est)}</td><td className="n">{KW(x.pot)}</td><td className="n">{KW(x.hol)}</td><td className="n">{(x.uso * 100).toFixed(1)} %</td></tr>
                ))}</tbody>
              </table></div>
            </div>}

            <div className="d-card w12"><h2>Estimación de demanda sin lectura</h2>
              <Kpis items={[["Recibos (RPU) estimados", N(d.est.n)], ["Factor de carga de referencia", ref.fc.toFixed(3)], ["Rango del FC (p25–p75)", `${ref.fcBajo.toFixed(3)} – ${ref.fcAlto.toFixed(3)}`],
                ["Demanda estimada (mes pico)", KW(d.est.pico)], ["Rango de la estimación", `${KW(d.est.bajo)} – ${KW(d.est.alto)}`]]} />
              <p className="d-mut">Demanda estimada = kWh del mes / (24 · días · FC), con el FC de {N(ref.n)} {ref.origen}. Tarifas estimadas: {d.est.tar || "—"}. El detalle está en «Validación y metodología».</p>
            </div>

            <div className="d-card w12"><div className="d-hrow"><h2>Validación de las lecturas de demanda</h2>
                <InfoPop titulo="Consideraciones de la validación">
                <p>Los kW se capturan del recibo y a veces traen errores, como dígitos pegados (36,707 kW en un servicio que siempre marca 16–22 kW). Antes de calcular cualquier indicador, cada recibo se compara contra su propio historial y un mes se corrige si cumple alguna de estas condiciones:</p>
                <ol>
                  <li><b>Valor fuera de lo común:</b> su kW es {FACTOR_ATIPICO} o más veces la mediana de los kW del mismo RPU (con al menos {MIN_MUESTRA} meses) y el consumo de ese mes no subió en proporción. Si el consumo sí acompaña el salto (verano, más equipo funcionando), el pico es real y no se toca.</li>
                  <li><b>kW en cero</b> en un mes con consumo.</li>
                  <li><b>kW físicamente imposible:</b> menor que la demanda media del mes (kWh / 24 · días), lo que implicaría consumir más energía de la que permite esa demanda.</li>
                  <li><b>Excede el máximo de su tarifa:</b> más de {PDBT_MAX_KW} kW en PDBT o más de {LIMITE_DOMESTICA_KW} kW en domésticas.</li>
                </ol>
                <p>El valor corregido es la <b>media de los meses válidos del mismo RPU</b>, sin bajar de la demanda media del mes. Si el recibo no tiene meses válidos, ese mes queda fuera de los indicadores de demanda. El kW original se conserva y aparece en esta tabla.</p>
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
            <div className="d-card w8"><Cab t="Costo mensual por zona" info={INF.c8} /><Grafica config={v.charts.c8} theme={theme} modos={["pct", "sep"]} /></div>
            <div className="d-card w4"><Cab t="Costo unitario por zona" info={INF.c9} /><Grafica config={v.charts.c9} theme={theme} modos={["log"]} /></div>
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
            <div className="d-card w8"><Cab t="Costo y consumo mensual de la zona" info={INF.d1} /><Grafica config={z.d1} theme={theme} modos={["clip"]} /></div>
            <div className="d-card w4"><Cab t="Costo por tarifa en la zona" info={INF.d2} /><Grafica config={z.d2} theme={theme} modos={["log"]} /></div>
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
              <div className="d-card w12"><Cab t="Costo y consumo por zona de carga" info={INF.nc} /><Grafica config={n.ch} theme={theme} modos={["log"]} /></div>
              <div className="d-card w12"><h2>Resumen por zona de carga</h2>
                <div className="d-tw"><table>
                  <thead><tr><th>Zona de carga</th><th>División CFE</th><th className="n">NodosP</th><th>Municipios</th><th className="n">Inmuebles</th><th className="n">MWh</th><th className="n">Gasto</th><th className="n">$/kWh</th><th className="n">Σ kW máx. GDMTH/GDMTO</th></tr></thead>
                  <tbody>{n.res.map((x) => (
                    <tr key={x.z} className="d-click" onClick={() => setZc(x.z)}><td><Punto c={colores.zc(x.z)} />{x.z}</td><td>{x.divs || "—"}</td><td className="n">{N(x.nn)}</td><td style={{ whiteSpace: "normal", minWidth: 220 }}>{x.muns.join(", ")}</td><td className="n">{N(x.inm)}</td>
                      <td className="n">{N(x.kwh / 1000)}</td><td className="n">{M(x.gasto)}</td><td className="n">{x.u ? P(x.u) : "—"}</td><td className="n">{KW(x.dem)}</td></tr>
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
        {tab === "vm" && (
          <div className="d-grid">
            <Sec t="Cambios realizados">
              <div className="d-tw"><table className="d-wrap">
                <thead><tr><th>Cambio</th><th>Antes</th><th>Ahora</th><th>Por qué</th></tr></thead>
                <tbody>{CAMBIOS.map((x) => <tr key={x[0]}><td><b>{x[0]}</b></td><td>{x[1]}</td><td>{x[2]}</td><td>{x[3]}</td></tr>)}</tbody>
              </table></div>
            </Sec>

            <Sec t="1. Origen de los datos" w="">
              <p>Los datos vienen del historial que ya carga el mapa desde Supabase; el tablero no hace otra consulta. Se muestran los meses desde {ANIO_DESDE}.</p>
              <ul>
                <li><b>Recibo = RPU.</b> Cada RPU único es un archivo de recibo; las filas son los meses de su historial. Por eso «recibos» cuenta RPU distintos y «meses de historial» cuenta filas.</li>
                <li><b>Meses repetidos.</b> Si un RPU trae el mismo mes dos veces, cuenta una sola: se queda el que trae importe, luego el que trae precio impreso y, si empatan, el de mayor consumo.</li>
                <li><b>Tarifas normalizadas.</b> «Tarifa 1A», «1a» y «1A» son la misma; igual «gdmth » y «GDMTH».</li>
                <li><b>Zona de carga.</b> Cada inmueble se liga por su municipio a la zona de carga más frecuente de sus NodosP en el catálogo del CENACE.</li>
              </ul>
            </Sec>

            <Sec t="2. Costo de cada mes" w="">
              <p>Cada mes toma su costo de la primera fuente disponible:</p>
              <ol>
                <li><b>Importe del recibo</b> (formato 2).</li>
                <li><b>kWh × precio impreso</b> cuando el recibo no trae importe (formato 1).</li>
                <li><b>Tabla oficial de CFE</b> cuando no hay ni importe ni precio.</li>
              </ol>
              <p><b>GDMTH</b> siempre se costea con la tabla oficial de CFE de su nodo (división tarifaria) y mes; lo facturado queda para comparar{t.nG ? <> ({N(t.nG)} meses: facturado {M(t.fact)}, calculado {M(t.calc)}, diferencia {(dif >= 0 ? "+" : "") + dif.toFixed(1)} %)</> : null}.</p>
              <p>El <b>costo unitario por tarifa</b> solo usa importe o precio impreso; no mezcla costos estimados.</p>
            </Sec>

            <Sec t="3. Cálculo con la tabla oficial de CFE">
              <p>Las tablas se descargan de «Conoce tu tarifa» de CFE para todos los municipios de Tamaulipas y se agrupan por nodo: los municipios con la misma tabla de cargos forman un grupo. Si falta el mes exacto, se usa el publicado más cercano.</p>
              <ul>
                <li>Cargos en <b>$/mes</b> × 1; en <b>$/kWh</b> × kWh del mes; en <b>$/kW</b> × demanda facturable = mín(kW máx., kWh / (24 · días · FC)), con FC de {Object.entries(FACTOR_CARGA).map(([k, x]) => `${x} en ${k}`).join(" y ")}.</li>
                <li>El recibo no trae kWh por periodo horario: la energía GDMTH se reparte {Math.round(PERFIL_HORARIO.base * 100)} % base, {Math.round(PERFIL_HORARIO.intermedia * 100)} % intermedia y {Math.round(PERFIL_HORARIO.punta * 100)} % punta.</li>
                <li>La capacidad se cobra sobre el kW máximo (el historial no trae la demanda en punta). Se suma {Math.round(IVA * 100)} % de IVA; no incluye DAP.</li>
              </ul>
              {t.vig.length > 0 ? <div className="d-tw"><table>
                <thead><tr><th>Tarifa</th><th>Nodo / división</th><th className="n">Municipios</th><th>Mes</th>{t.cols.map(([k, l]) => <th key={k} className="n">{l}</th>)}</tr></thead>
                <tbody>{t.vig.map((x) => (
                  <tr key={x.tar + x.g.id}><td>{x.tar}</td><td>{x.g.division}</td><td className="n" title={x.g.municipios.join(", ")}>{x.g.municipios.includes("*") ? "Todos" : x.g.municipios.length}</td><td>{x.ult}</td>
                    {t.cols.map(([k]) => <td key={k} className="n">{x.c[k] ? `${x.c[k].v.toLocaleString("es-MX", { maximumFractionDigits: 4 })} ${x.c[k].u}` : "—"}</td>)}</tr>
                ))}</tbody>
              </table></div> : <p className="d-mut">Aún no hay tablas descargadas (<code>node scripts/scrape-tarifas-cfe.mjs</code>).</p>}
            </Sec>

            <Sec t="4. Validación de la demanda medida" w="">
              <p>Se aplica antes de cualquier cálculo. Un mes se corrige si su kW es {FACTOR_ATIPICO} o más veces la mediana del RPU sin que el consumo lo respalde (el kWh creció menos de {Math.round(RESPALDO_CONSUMO * 100)} % de lo que creció el kW), si viene en cero con consumo, si es menor que kWh / (24 · días) o si excede el máximo de su tarifa.</p>
              <p>El reemplazo es la media de los meses válidos del mismo RPU. Si no hay meses válidos, el mes no entra a los indicadores de demanda. Resultado del filtro actual: {N(d.val.corr)} meses corregidos y {N(d.val.desc)} descartados de {N(d.val.meses)}.</p>
            </Sec>

            <Sec t="5. Demanda estimada (PDBT y recibos sin lectura)" w="">
              <p>Demanda estimada = kWh del mes / (24 · días · FC). El FC se obtiene de los propios datos: la mediana del factor de carga de servicios medidos de tamaño parecido (kW mediano ≤ {PDBT_MAX_KW} y consumo mensual hasta el percentil 95 de los no medidos). Primero se saca la mediana de cada RPU y luego la mediana entre RPU.</p>
              <p>Filtro actual: FC {ref.fc.toFixed(3)} de {N(ref.n)} {ref.origen}, con rango {ref.fcBajo.toFixed(3)}–{ref.fcAlto.toFixed(3)}. En PDBT el resultado no pasa de {PDBT_MAX_KW} kW. Si hay menos de 5 servicios similares se usan todos los medidos, y si no hay ninguno, FC = {FC_DEFECTO}.</p>
            </Sec>

            <Sec t="6. Demanda general y proyección" w="">
              <ul>
                <li><b>Demanda general aproximada:</b> en cada mes se suma la demanda de cada recibo (medida y validada, o estimada) y se reporta el mes más alto. No se suman los máximos de meses distintos, porque eso sobrestima.</li>
                <li><b>Demanda máxima individual:</b> el recibo con mayor demanda en un mes, de la tarifa elegida o de todas.</li>
                <li><b>Proyección al máximo permitido:</b> recibos PDBT y domésticos × su máximo ({PDBT_MAX_KW} kW en PDBT; {LIMITE_DOMESTICA_KW} kW en domésticas, supuesto porque la tarifa doméstica no fija un tope).</li>
              </ul>
            </Sec>

            <Sec t="7. Calidad del costo" w="">
              <p>Un mes se marca como atípico si su $/kWh efectivo es menor que ${PRECIO_MIN} o mayor que ${PRECIO_MAX}; casi siempre son kWh mal capturados o un mes de puros cargos fijos. Siguen sumando al gasto.</p>
            </Sec>

            <div className="d-card w12"><h2>Origen del costo en el filtro actual</h2>
              <div className="d-tw"><table>
                <thead><tr><th>Origen del costo</th><th className="n">Meses de historial</th><th className="n">MWh</th><th className="n">% del consumo</th><th className="n">Gasto</th><th className="n">$/kWh</th></tr></thead>
                <tbody>{v.orig.map((x) => (
                  <tr key={x.k}><td>{ORIGEN[x.k]}</td><td className="n">{N(x.n)}</td><td className="n">{N(x.kwh / 1000)}</td><td className="n">{PCT(x.kwh, K)}</td><td className="n">{x.k === "none" ? "—" : M(x.g)}</td><td className="n">{x.k === "none" || !x.kwh ? "—" : P(x.g / x.kwh)}</td></tr>
                ))}</tbody>
              </table></div>
              {v.atip.length > 0 && <>
                <h2 style={{ marginTop: 14 }}>Meses con $/kWh atípico</h2>
                <div className="d-tw"><table>
                  <thead><tr><th>RPU</th><th>Inmueble</th><th>Periodo</th><th className="n">kWh</th><th className="n">Facturado</th><th className="n">$/kWh</th><th>Fuente</th></tr></thead>
                  <tbody>{v.atip.slice(0, 15).map((r) => (
                    <tr key={r.rpu + r.per}><td>{r.rpu}</td><td>{model.props[r.i].nombre}</td><td>{r.per}</td><td className="n">{N(r.kwh)}</td><td className="n">{P(r.fact)}</td><td className="n x">{r.kwh ? P(r.fact / r.kwh) : "—"}</td><td>{r.hasImp ? "Importe" : "Precio impreso"}</td></tr>
                  ))}</tbody>
                </table></div></>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
