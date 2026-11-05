export interface Zona { id: number; nombre: string; lat: number; lon: number }
export interface ZonaMunicipio { cve_mun: string; municipio: string; zona_id: number }

/** Filas crudas de las vistas del esquema mapa_web */
export interface RawData {
  inmuebles: Record<string, any>[];
  historial: Record<string, any>[];
  zonas: Zona[];
  zonaMunicipio: ZonaMunicipio[];
}

export type Measure = "consumo" | "precio" | "demanda";
export type CatMode = "dependencia" | "tarifa" | "interconexion" | "ubicacion";
export type ColorBy = Measure | CatMode;

export interface MonthInfo { key: string; y: number; m: number }

/** Un inmueble: solo lo estático. Las series mensuales viven en matrices tipadas (Model.kwh, etc.) */
export interface Prop {
  i: number;
  id: unknown;
  nombre: string; direccion: string; rpu: string;
  dependencia: string; tarifa: string; municipio: string;
  feature: string | null; bidir: boolean; nodo: unknown; valid: boolean | null;
  demandaAplica: boolean | null; formato: number | null;
  region: string; regionTipo: string; endRaw: string | null; endKey: string | null;
  lat: number; lon: number; hasXY: boolean;
  zone: number; sub: number; hasHist: boolean;
  prSrc: "impreso" | "importe" | null;
}

export interface ZoneInfo extends Zona { cves: string[]; count: number; members: Int32Array }
export interface SubInfo {
  id: number; zone: number; nombre: string; municipio: string;
  lat: number; lon: number; members: Int32Array; single: boolean;
}

export interface Scale { p2: number; p98: number; median: number; breaks: number[]; serie: string; colors: string[] }
export interface CatScale { labels: string[]; colors: string[] }

export interface HistRow { key: string; kwh: number; kw: number; imp: number; pr: number; src: "impreso" | "importe" | null }

/** Todo lo que el worker entrega a la interfaz. Las matrices se transfieren sin copiar. */
export interface Model {
  N: number; M: number;
  months: MonthInfo[];
  props: Prop[];
  zones: ZoneInfo[];
  subs: SubInfo[];
  deps: string[];
  hasEndColumn: boolean;
  /** matrices N×M (fila = inmueble), NaN = sin dato */
  kwh: Float64Array; kw: Float64Array; imp: Float64Array; pr: Float64Array;
  /** índice de categoría por inmueble, para cada modo categórico */
  catIdx: Record<CatMode, Int16Array>;
  cats: Record<CatMode, CatScale>;
  depIdx: Int16Array;      // índice en deps
  finCat: Uint8Array;      // 0 otro mes, 1 = 2026-01, 2 = 2026-02
  scales: Record<Measure, Scale>;
  month0: number;
  /** historial completo en columnas planas; el inmueble i ocupa [histOff[i], histOff[i+1]) */
  histOff: Uint32Array; hKey: Uint16Array; hKwh: Float64Array; hKw: Float64Array;
  hImp: Float64Array; hPr: Float64Array; hSrc: Uint8Array;
  /** GeoJSON de los puntos como texto: se vuelve un Blob y MapLibre lo procesa en su propio hilo */
  pointsJson: string;
}
