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
  /** ubicacion_confiable: a 250 m o menos del plantel del catálogo, o ubicada con link de Google Maps */
  confiable: boolean | null;
  /** División y zona de distribución de CFE, del código de la cuenta del recibo ("" = sin recibo) */
  division: string; zonaDist: string;
  /** El último recibo no trae lectura real; kwhEst = kWh que probablemente se cobraron (NaN si no aplica) */
  lectEst: boolean; kwhEst: number;
  /** Demanda contratada del inmueble en kW (NaN si Supabase no la trae). La usa el tablero de recibos. */
  contratada: number;
  demandaAplica: boolean | null; formato: number | null;
  region: string; regionTipo: string; endRaw: string | null; endKey: string | null;
  lat: number; lon: number; hasXY: boolean;
  zone: number; sub: number; hasHist: boolean;
}

export interface ZoneInfo extends Zona { cves: string[]; count: number; members: Int32Array }
export interface SubInfo {
  id: number; zone: number; nombre: string; municipio: string;
  lat: number; lon: number; members: Int32Array; single: boolean;
}

export interface Scale { p2: number; p98: number; median: number; breaks: number[]; serie: string; colors: string[] }
export interface CatScale { labels: string[]; colors: string[] }

/** Por qué un mes no tiene precio comparable (precio_origen de mapa_web.historial) */
export type SinPrecio = "consumo_minimo" | "atipico" | "refacturacion" | "sin_decena" | "lectura_estimada";
/** Un mes del historial para el mapa. kwh es NaN si la lectura fue estimada (est) y kw si la demanda es dudosa (dud).
    pr = precio sin IVA, sub = subtotal sin IVA; sinPr dice por qué pr está vacío, si se sabe. */
export interface HistRow {
  key: string; kwh: number; kw: number; sub: number; pr: number;
  est: boolean; dud: boolean; sinPr: SinPrecio | null;
}

/** Todo lo que el worker entrega a la interfaz. Las matrices se transfieren sin copiar. */
export interface Model {
  N: number; M: number;
  months: MonthInfo[];
  props: Prop[];
  zones: ZoneInfo[];
  subs: SubInfo[];
  deps: string[];
  hasEndColumn: boolean;
  /** matrices N×M (fila = inmueble), NaN = sin dato. pr = precio sin IVA, sub = subtotal sin IVA;
      kw queda en NaN donde la demanda es dudosa; est = 1 si el mes es de lectura estimada */
  kwh: Float64Array; kw: Float64Array; imp: Float64Array; pr: Float64Array; sub: Float64Array; est: Uint8Array;
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
  /** Columnas del mapa (el tablero de recibos sigue con hImp / hPr / hSrc): precio y subtotal sin IVA,
      origen del precio (0 con precio o sin dato; 1..5 = SIN_PRECIO), lectura estimada y demanda dudosa */
  hPrS: Float64Array; hSub: Float64Array; hOri: Uint8Array; hEst: Uint8Array; hDud: Uint8Array;
  /** Solo para el tablero de recibos (historial_calculo): tarifa del recibo en ese mes ("" si no viene),
      formato del recibo (0 sin dato), mes ajustado y consumo atípico (1 = marcado) */
  hTar: string[]; hFmt: Uint8Array; hAjus: Uint8Array; hCAt: Uint8Array;
  /** GeoJSON de los puntos como texto: se vuelve un Blob y MapLibre lo procesa en su propio hilo */
  pointsJson: string;
}
