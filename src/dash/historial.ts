/**
 * Convierte los registros del historial (vista de Supabase o CSV) a los arreglos que usa el modelo.
 * Úsalo en el loader donde hoy se arman hKey/hKwh/hKw/hImp, para que también lleguen RPU, precio_kwh, formato y ajustado.
 *
 *   const h = columnasHistorial(registrosOrdenadosPorInmueble);
 *   model.hKey = h.hKey; model.hKwh = h.hKwh; model.hKw = h.hKw; model.hImp = h.hImp;
 *   (model as any).hRpu = h.hRpu; (model as any).hPrecio = h.hPrecio; (model as any).hFmt = h.hFmt; (model as any).hAjus = h.hAjus;
 */
export interface RegistroHistorial {
  rpu: string; periodo_inicio: string; periodo_fin?: string;
  kwh: number | string | null; kw: number | string | null; importe: number | string | null;
  precio_kwh?: number | string | null; precio_fuente?: string | null; formato?: number | string | null;
  fechas_aproximadas?: boolean | string | null; ajustado?: boolean | string | null;
}
const num = (x: unknown) => (x === null || x === undefined || x === "" ? NaN : Number(x));
const bool = (x: unknown) => x === true || String(x).toLowerCase() === "true";
/** Mismo código de periodo que espera rows.ts: hKey + 24000 = año · 12 + (mes − 1) */
export const claveMes = (fecha: string) => { const [y, m] = fecha.slice(0, 7).split("-").map(Number); return y * 12 + (m - 1) - 24000; };

export function columnasHistorial(regs: RegistroHistorial[]) {
  const n = regs.length;
  const h = { hKey: new Int32Array(n), hKwh: new Float64Array(n), hKw: new Float64Array(n), hImp: new Float64Array(n),
    hPrecio: new Float64Array(n), hFmt: new Uint8Array(n), hAjus: new Uint8Array(n), hRpu: new Array<string>(n) };
  regs.forEach((r, j) => {
    h.hKey[j] = claveMes(r.periodo_inicio); h.hKwh[j] = num(r.kwh); h.hKw[j] = num(r.kw); h.hImp[j] = num(r.importe);
    h.hPrecio[j] = num(r.precio_kwh); h.hFmt[j] = num(r.formato) || 0; h.hAjus[j] = bool(r.ajustado) ? 1 : 0; h.hRpu[j] = String(r.rpu ?? "").trim();
  });
  return h;
}
