/* Hilo aparte: pide los datos a Supabase (con caché local), arma el modelo y lo entrega con las matrices
   transferidas sin copiar. Así el hilo principal solo dibuja. */
import { buildModel } from "./buildModel";
import { CONFIG } from "../lib/constants";
import { DEFAULT_ZONAS, DEFAULT_ZONA_MUNICIPIO } from "../lib/zonasDefault";
import type { Model, RawData } from "./types";

const ctx = self as unknown as {
  postMessage(m: unknown, t?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

export type WorkerOut =
  | { type: "model"; model: Model; source: "cache" | "red" | "archivo" | "vacio" }
  | { type: "same" }
  | { type: "auth" }
  | { type: "toast"; text: string; ms: number };

const CACHE_VERSION = 1;
let token = "";
let uid = "";
class AuthError extends Error {}
const EMPTY: RawData = { inmuebles: [], historial: [], zonas: DEFAULT_ZONAS, zonaMunicipio: DEFAULT_ZONA_MUNICIPIO };

function postModel(raw: RawData, source: "cache" | "red" | "archivo" | "vacio") {
  const model = buildModel(raw);
  const t: Transferable[] = [
    model.kwh.buffer, model.kw.buffer, model.imp.buffer, model.pr.buffer, model.depIdx.buffer, model.finCat.buffer,
    model.histOff.buffer, model.hKey.buffer, model.hKwh.buffer, model.hKw.buffer, model.hImp.buffer, model.hPr.buffer, model.hSrc.buffer,
    ...Object.values(model.catIdx).map((a) => a.buffer),
    ...model.zones.map((z) => z.members.buffer), ...model.subs.map((s) => s.members.buffer)
  ];
  ctx.postMessage({ type: "model", model, source } satisfies WorkerOut, t);
}
const toast = (text: string, ms = 6000) => ctx.postMessage({ type: "toast", text, ms } satisfies WorkerOut);

/* ---------- Supabase: pagina de 1000 en 1000, varias páginas a la vez ---------- */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); }
  }));
  return out;
}
async function sbFetchAll(view: string, select: string, order?: string): Promise<Record<string, any>[]> {
  const base = `${CONFIG.supabaseUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(view)}?select=${encodeURIComponent(select)}` + (order ? `&order=${order}` : "");
  const headers = { apikey: CONFIG.supabaseAnonKey, Authorization: `Bearer ${token || CONFIG.supabaseAnonKey}`, "Accept-Profile": CONFIG.esquema };
  const size = CONFIG.pageSize;
  const page = async (from: number, count: boolean) => {
    const res = await fetch(base, { headers: { ...headers, "Range-Unit": "items", Range: `${from}-${from + size - 1}`, ...(count ? { Prefer: "count=exact" } : {}) } });
    if (res.status === 401) throw new AuthError("sesión vencida");
    if (!res.ok) throw new Error(`${view}: ${res.status} ${await res.text()}`);
    return { rows: (await res.json()) as Record<string, any>[], range: res.headers.get("content-range") };
  };
  const first = await page(0, true);
  const total = parseInt((first.range || "").split("/")[1], 10);
  if (!isFinite(total) || total <= first.rows.length) return first.rows;
  const starts: number[] = [];
  for (let s = size; s < total; s += size) starts.push(s);
  const rest = await pool(starts.map((s) => () => page(s, false).then((p) => p.rows)), CONFIG.concurrency);
  return first.rows.concat(...rest);
}
async function loadSupabase(): Promise<RawData> {
  const v = CONFIG.views;
  const [inmuebles, historial] = await Promise.all([
    sbFetchAll(v.inmuebles, "*", "id"),
    sbFetchAll(v.historial, "rpu,periodo_inicio,kwh,kw,importe,precio_kwh,precio_fuente", "rpu,periodo_inicio")
  ]);
  let zonas = DEFAULT_ZONAS, zonaMunicipio = DEFAULT_ZONA_MUNICIPIO;
  if (v.zonas && v.zonaMunicipio) {
    try {
      const [z, zm] = await Promise.all([sbFetchAll(v.zonas, "id,nombre,lat,lon", "id"), sbFetchAll(v.zonaMunicipio, "cve_mun,municipio,zona_id", "cve_mun")]);
      if (z.length && zm.length) { zonas = z as any; zonaMunicipio = zm as any; }
    } catch (e) { console.info("Vistas de zonas no disponibles; se usan las zonas integradas.", (e as Error).message); }
  }
  return { inmuebles, historial, zonas, zonaMunicipio };
}

/* ---------- Caché local (IndexedDB): la segunda visita pinta con datos al instante ---------- */
const idb = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open("mapa-inmuebles", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("kv");
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction("kv").objectStore("kv").get(key); q.onsuccess = () => res(q.result as T); q.onerror = () => rej(q.error); });
}
async function idbSet(key: string, val: unknown): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(val, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ":" + s.length;
}
const fingerprint = (raw: RawData) => hash(JSON.stringify(raw.inmuebles)) + "|" + hash(JSON.stringify(raw.historial));
interface Cached { v: number; t: number; fp: string; raw: RawData }

async function run() {
  if (CONFIG.datosUrl) {
    try {
      const raw = (await (await fetch(CONFIG.datosUrl)).json()) as Partial<RawData>;
      postModel({ inmuebles: raw.inmuebles ?? [], historial: raw.historial ?? [], zonas: raw.zonas ?? DEFAULT_ZONAS, zonaMunicipio: raw.zonaMunicipio ?? DEFAULT_ZONA_MUNICIPIO }, "archivo");
    } catch (e) { postModel(EMPTY, "vacio"); toast("No se pudo leer " + CONFIG.datosUrl + ". El mapa está vacío.", 15000); }
    return;
  }
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
    postModel(EMPTY, "vacio");
    toast("Falta VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env: el mapa está vacío.", 15000);
    return;
  }
  let cached: Cached | undefined;
  try { cached = await idbGet<Cached>("raw:" + uid); } catch { /* sin IndexedDB: se sigue sin caché */ }
  if (cached && cached.v !== CACHE_VERSION) cached = undefined;
  if (cached) {
    postModel(cached.raw, "cache");
    if (Date.now() - cached.t < CONFIG.cacheMinutes * 60_000) return;
  }
  try {
    const raw = await loadSupabase();
    const fp = fingerprint(raw);
    if (cached && cached.fp === fp) {
      ctx.postMessage({ type: "same" } satisfies WorkerOut);
    } else {
      postModel(raw, "red");
    }
    idbSet("raw:" + uid, { v: CACHE_VERSION, t: Date.now(), fp, raw } satisfies Cached).catch(() => {});
  } catch (e) {
    if (e instanceof AuthError) { ctx.postMessage({ type: "auth" } satisfies WorkerOut); return; }
    const msg = (e as Error).message.slice(0, 120);
    if (cached) toast("Sin conexión con Supabase (" + msg + "). Se muestran los últimos datos guardados.", 10000);
    else { postModel(EMPTY, "vacio"); toast("No se pudo leer Supabase (" + msg + "). El mapa está vacío.", 15000); }
  }
}
ctx.onmessage = (e) => { if (e.data?.type === "load") { token = e.data.token; uid = e.data.uid; void run(); } };
