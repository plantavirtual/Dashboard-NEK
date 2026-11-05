import type { CatMode, Measure } from "../data/types";

export const CONFIG = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "",
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "",
  datosUrl: (import.meta.env.VITE_DATOS_URL as string | undefined) ?? "",
  esquema: "mapa_web",
  views: {
    inmuebles: "inmuebles",
    historial: "historial",
    zonas: null as string | null,
    zonaMunicipio: null as string | null
  },
  pageSize: 1000,        // Supabase limita a 1000 filas por petición por omisión
  concurrency: 8,        // peticiones en paralelo por vista
  cacheMinutes: 10,      // no se vuelve a pedir a Supabase si el caché local es más reciente
  // Línea de tiempo: 13 meses (AAAA-MM). El panel de cada inmueble muestra el historial completo.
  mesInicio: "2025-02",
  mesFin: "2026-02",
  endColumn: "recibo_fin"
};

export const RAMP = ["#e9e3bd", "#cfdfb0", "#aed3aa", "#8cc4ad", "#73b1b4", "#6a9bbd", "#6c85c3", "#6d6db9", "#6655a4", "#533c84"];
export const NODATA = "#c3c5cf";
export const VIEW2 = 8.5, VIEW3 = 12;
export const ZOOM_CALLES = 11;   // zoom donde aparece el mapa de calles: VIEW2 < ZOOM_CALLES < VIEW3
export const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const MES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export const MEASURES: Record<Measure, { title: string; unit: string; chartColor: string }> = {
  consumo: { title: "Consumo", unit: "kWh/mes", chartColor: "#a9b6ee" },
  precio: { title: "Precio por kWh", unit: "$/kWh", chartColor: "#f3cf96" },
  demanda: { title: "Demanda", unit: "kW", chartColor: "#f0b3c4" }
};
export const CATEGORY_MODES: Record<CatMode, { title: string }> = {
  dependencia: { title: "Dependencia" },
  tarifa: { title: "Tarifa" },
  interconexion: { title: "Interconexión" },
  ubicacion: { title: "Ubicación validada" }
};

export const FEATURE_LABEL: Record<string, string> = { FOTOVOLTAICO: "Fotovoltaico", NETMET: "NETMET" };
export const FEATURE_COLORS: Record<string, string> = { "Fotovoltaico": "#f0c27a", "NETMET": "#8fa3e8", "Sin interconexión": "#d5d7e0" };
export const CAT_PALETTE = ["#8fa3e8", "#e89aa8", "#f0c27a", "#6fc2b0", "#b79be0", "#7fb8c9", "#c9b48f", "#a8d08d", "#e7a3d0", "#9fb0c4"];
export const TARIFA_COLORS: Record<string, string> = { PDBT: "#f0c27a", GDBT: "#8fd0b6", GDMTO: "#8fa3e8", GDMTH: "#6f62bd" };
export const UBIC_COLORS: Record<string, string> = { "Validada": "#86cf98", "Sin validar": "#ef9c9c", "Sin dato": "#c3c5cf" };

/** Uso del suelo (INEGI Serie V) en dos mitades: algunos teléfonos no cargan texturas de más de 4 096 px */
export const USO_SUELO = [
  { id: "suelo-n", url: "data/suelo-n.webp", coordinates: [[-100.145, 27.6791], [-97.144627, 27.6791], [-97.144627, 24.974196], [-100.145, 24.974196]] as [number, number][] },
  { id: "suelo-s", url: "data/suelo-s.webp", coordinates: [[-100.145, 24.974196], [-97.144627, 24.974196], [-97.144627, 22.207451], [-100.145, 22.207451]] as [number, number][] }
];
export const SUELO_ZOOM = [8.5, 10];   // opaco hasta el nivel 2 (8.5); transparente desde 10

/** Caja del estado (precalculada de estado.json): evita parsear la geometría en el hilo principal */
export const STATE_BBOX: [number, number, number, number] = [-100.145, 22.207, -97.1443, 27.6791];

export const CTX_LABELS = [
  { t: "TEXAS", lon: -98.3, lat: 27.45, cls: "state" },
  { t: "NUEVO LEÓN", lon: -99.95, lat: 25.2, cls: "state" },
  { t: "SAN LUIS POTOSÍ", lon: -99.6, lat: 22.3, cls: "state" },
  { t: "VERACRUZ", lon: -98.2, lat: 21.75, cls: "state" },
  { t: "GOLFO DE MÉXICO", lon: -95.7, lat: 24.1, cls: "gulf" },
  { t: "Laguna Madre", lon: -97.48, lat: 24.75, cls: "feat", rot: -78 },
  { t: "Sierra Madre Oriental", lon: -99.47, lat: 23.95, cls: "feat", rot: -62 }
] as { t: string; lon: number; lat: number; cls: string; rot?: number }[];

export const VIEW_LABELS = ["Regiones principales", "Subgrupos", "Inmuebles individuales"];
