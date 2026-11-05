import { CAT_PALETTE, CONFIG, FEATURE_COLORS, TARIFA_COLORS, UBIC_COLORS } from "../lib/constants";
import { catLabel } from "../lib/categories";
import { makeScale, classOf } from "../lib/scales";
import { mulberry32, normName } from "../lib/format";
import type {
  CatMode, CatScale, Measure, Model, MonthInfo, Prop, RawData, Scale, SubInfo, ZoneInfo
} from "./types";

const pad2 = (m: number) => String(m).padStart(2, "0");
const EPOCH = 24000; // año 2000 × 12: las claves de mes caben en un Uint16
const num = (v: unknown) => (v == null || v === "" ? NaN : Number(v));

function monthList(inicio: string, fin: string): MonthInfo[] {
  const out: MonthInfo[] = [];
  let [y, m] = inicio.split("-").map(Number);
  while (`${y}-${pad2(m)}` <= fin) {
    out.push({ key: `${y}-${pad2(m)}`, y, m: m - 1 });
    if (m === 12) { y++; m = 1; } else m++;
  }
  return out;
}

/** Construye todo el modelo fuera del hilo principal. Entrega matrices tipadas en vez de miles de objetos. */
export function buildModel(data: RawData): Model {
  const months = monthList(CONFIG.mesInicio, CONFIG.mesFin);
  const M = months.length;
  const mIndex = new Map(months.map((m, i) => [m.key, i]));
  const N = data.inmuebles.length;

  // ---- Zonas y municipios
  const zones: ZoneInfo[] = data.zonas.map((z) => ({
    id: +z.id, nombre: z.nombre, lat: +z.lat, lon: +z.lon, cves: [], count: 0, members: new Int32Array(0)
  }));
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const muniZone = new Map<string, number>();
  for (const r of data.zonaMunicipio) {
    muniZone.set(normName(r.municipio), +r.zona_id);
    zoneById.get(+r.zona_id)?.cves.push(String(r.cve_mun).padStart(3, "0"));
  }

  // ---- Inmuebles
  const kwh = new Float64Array(N * M).fill(NaN), kw = new Float64Array(N * M).fill(NaN);
  const imp = new Float64Array(N * M).fill(NaN), pr = new Float64Array(N * M).fill(NaN);
  const byRpu = new Map<string, number>();
  const props: Prop[] = data.inmuebles.map((r, i) => {
    const lat = Number(r.latitud), lon = Number(r.longitud);
    const p: Prop = {
      i, id: r.id, nombre: r.nombre || "Sin nombre", direccion: r.direccion || "", rpu: r.rpu == null ? "" : String(r.rpu),
      dependencia: r.dependencia || "Sin dependencia", tarifa: r.tarifa || "", municipio: r.municipio || "",
      feature: r.interconexion || null, bidir: r.medidor_bidireccional === true, nodo: r.nodo, valid: r.ubicacion_validada ?? null,
      demandaAplica: r.demanda_aplica ?? null, formato: r.historial_formato == null ? null : +r.historial_formato,
      region: r.region_nombre || "", regionTipo: r.region_tipo || "Colonia", endRaw: r[CONFIG.endColumn] ?? null, endKey: null,
      lat, lon, hasXY: isFinite(lat) && isFinite(lon) && lat !== 0 && lon !== 0,
      zone: -1, sub: -1, hasHist: false, prSrc: null
    };
    if (p.rpu) byRpu.set(p.rpu, i);
    return p;
  });

  // ---- Historial: matrices de la línea de tiempo + columnas planas del historial completo
  const bucket: number[][] = Array.from({ length: N }, () => []);
  for (let j = 0; j < data.historial.length; j++) {
    const r = data.historial[j];
    const i = byRpu.get(String(r.rpu));
    if (i == null) continue;
    const key = String(r.periodo_inicio).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    bucket[i].push(j);
    const mi = mIndex.get(key);
    if (mi == null) continue;
    const o = i * M + mi;
    kwh[o] = num(r.kwh); kw[o] = num(r.kw); imp[o] = num(r.importe); pr[o] = num(r.precio_kwh);
  }
  let total = 0;
  for (const b of bucket) total += b.length;
  const histOff = new Uint32Array(N + 1), hKey = new Uint16Array(total);
  const hKwh = new Float64Array(total), hKw = new Float64Array(total), hImp = new Float64Array(total), hPr = new Float64Array(total);
  const hSrc = new Uint8Array(total);
  const ym = (r: Record<string, any>) => {
    const k = String(r.periodo_inicio).slice(0, 7);
    return +k.slice(0, 4) * 12 + (+k.slice(5, 7) - 1) - EPOCH;
  };
  let w = 0;
  for (let i = 0; i < N; i++) {
    histOff[i] = w;
    const rows = bucket[i].map((j) => data.historial[j]).sort((a, b) => ym(a) - ym(b));
    let n1 = 0, n2 = 0;
    for (const r of rows) {
      hKey[w] = ym(r); hKwh[w] = num(r.kwh); hKw[w] = num(r.kw); hImp[w] = num(r.importe); hPr[w] = num(r.precio_kwh);
      const s = r.precio_fuente === "impreso" ? 1 : r.precio_fuente === "importe" ? 2 : 0;
      hSrc[w] = s; if (s === 1) n1++; else if (s === 2) n2++;
      w++;
    }
    const p = props[i];
    p.prSrc = n1 || n2 ? (n1 >= n2 ? "impreso" : "importe") : null;
    let has = false;
    for (let k = 0; k < M && !has; k++) has = isFinite(kwh[i * M + k]) || isFinite(imp[i * M + k]);
    p.hasHist = has;
  }
  histOff[N] = w;

  // ---- Zona de cada inmueble: por municipio; si no coincide, la zona más cercana por coordenadas
  let unmatched = 0;
  for (const p of props) {
    const z = muniZone.get(normName(p.municipio));
    if (z != null && zoneById.has(z)) { p.zone = z; continue; }
    unmatched++;
    if (p.hasXY) {
      let best = -1, bd = Infinity;
      for (const zz of zones) { const d = (zz.lat - p.lat) ** 2 + ((zz.lon - p.lon) * 0.9) ** 2; if (d < bd) { bd = d; best = zz.id; } }
      p.zone = best;
    }
  }
  if (unmatched) console.warn(`${unmatched} inmuebles con municipio sin zona; se asignaron a la zona más cercana.`);
  for (const z of zones) {
    const idx: number[] = [];
    for (const p of props) if (p.zone === z.id) idx.push(p.i);
    z.members = Int32Array.from(idx); z.count = idx.length;
  }

  // ---- Dependencias, fin del último recibo
  const deps = [...new Set(props.map((p) => p.dependencia))].sort((a, b) => a.localeCompare(b, "es"));
  const depPos = new Map(deps.map((d, i) => [d, i]));
  const depIdx = new Int16Array(N);
  const hasEndColumn = data.inmuebles.some((r) => r[CONFIG.endColumn] != null);
  const finCat = new Uint8Array(N);
  for (const p of props) {
    depIdx[p.i] = depPos.get(p.dependencia)!;
    if (hasEndColumn) p.endKey = p.endRaw ? String(p.endRaw).slice(0, 7) : null;
    else {
      let last = -1;
      for (let k = 0; k < M; k++) if (isFinite(kwh[p.i * M + k]) || isFinite(imp[p.i * M + k])) last = k;
      p.endKey = last >= 0 ? months[last].key : null;
    }
    finCat[p.i] = p.endKey === "2026-01" ? 1 : p.endKey === "2026-02" ? 2 : 0;
  }

  // ---- Categorías y sus colores
  const modes: CatMode[] = ["dependencia", "tarifa", "interconexion", "ubicacion"];
  const cats = {} as Record<CatMode, CatScale>;
  const catIdx = {} as Record<CatMode, Int16Array>;
  const byCount = (mode: CatMode) => {
    const c = new Map<string, number>();
    for (const p of props) { const k = catLabel(p, mode); c.set(k, (c.get(k) || 0) + 1); }
    return [...c.keys()].sort((a, b) => c.get(b)! - c.get(a)!);
  };
  cats.dependencia = { labels: byCount("dependencia"), colors: [] };
  cats.dependencia.colors = cats.dependencia.labels.map((_, i) => CAT_PALETTE[i % CAT_PALETTE.length]);
  cats.tarifa = { labels: byCount("tarifa"), colors: [] };
  cats.tarifa.colors = cats.tarifa.labels.map((k, i) => TARIFA_COLORS[k] || CAT_PALETTE[(i + 4) % CAT_PALETTE.length]);
  cats.ubicacion = { labels: ["Validada", "Sin validar", "Sin dato"], colors: ["Validada", "Sin validar", "Sin dato"].map((k) => UBIC_COLORS[k]) };
  cats.interconexion = { labels: Object.keys(FEATURE_COLORS), colors: Object.values(FEATURE_COLORS) };
  for (const mode of modes) {
    const pos = new Map(cats[mode].labels.map((l, i) => [l, i]));
    const a = new Int16Array(N);
    for (const p of props) a[p.i] = pos.get(catLabel(p, mode)) ?? -1;
    catIdx[mode] = a;
  }

  // ---- Subgrupos (k-means por zona, con semilla fija)
  const subs = buildSubgroups(zones, props);

  // ---- Escalas (todas las medidas, todos los meses de la línea de tiempo)
  const mats: Record<Measure, Float64Array> = { consumo: kwh, demanda: kw, precio: pr };
  const scales = {} as Record<Measure, Scale>;
  for (const measure of ["consumo", "precio", "demanda"] as Measure[]) {
    const src = mats[measure];
    let n = 0;
    for (let i = 0; i < src.length; i++) if (src[i] > 0 && isFinite(src[i])) n++;
    const vals = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < src.length; i++) if (src[i] > 0 && isFinite(src[i])) vals[j++] = src[i];
    vals.sort();   // TypedArray.sort ordena numéricamente
    scales[measure] = makeScale(vals);
  }

  // ---- Mes inicial: el último con registro de al menos la mitad de los inmuebles con historial
  let conHist = 0;
  for (const p of props) if (p.hasHist) conHist++;
  let month0 = M - 1;
  const countMonth = (k: number) => { let c = 0; for (let i = 0; i < N; i++) if (isFinite(kwh[i * M + k])) c++; return c; };
  while (month0 > 0 && countMonth(month0) < conHist * 0.5) month0--;

  // ---- GeoJSON de puntos, una sola vez. El color de cada mes va como clase en propiedades planas (k0.., p0.., w0..)
  // y el mapa solo cambia la expresión de color al cambiar mes, medida o filtros: nunca se vuelve a generar la fuente.
  const feats: string[] = [];
  for (const p of props) {
    if (!p.hasXY) continue;
    const o: Record<string, number> = {
      i: p.i, z: p.zone, s: p.sub, h: p.hasHist ? 1 : 0, f: p.feature ? 1 : 0, e: finCat[p.i], cd: depIdx[p.i],
      ct: catIdx.tarifa[p.i], ci: catIdx.interconexion[p.i], cu: catIdx.ubicacion[p.i]
    };
    for (let k = 0; k < M; k++) {
      o["k" + k] = classOf(kwh[p.i * M + k], scales.consumo.breaks);
      o["p" + k] = classOf(pr[p.i * M + k], scales.precio.breaks);
      o["w" + k] = classOf(kw[p.i * M + k], scales.demanda.breaks);
    }
    feats.push(`{"type":"Feature","geometry":{"type":"Point","coordinates":[${p.lon},${p.lat}]},"properties":${JSON.stringify(o)}}`);
  }
  const pointsJson = `{"type":"FeatureCollection","features":[${feats.join(",")}]}`;

  return {
    N, M, months, props, zones, subs, deps, hasEndColumn, kwh, kw, imp, pr, catIdx, cats, depIdx, finCat, scales, month0,
    histOff, hKey, hKwh, hKw, hImp, hPr, hSrc, pointsJson
  };
}

function buildSubgroups(zones: ZoneInfo[], props: Prop[]): SubInfo[] {
  const subs: SubInfo[] = [];
  for (const z of zones) {
    const members = Array.from(z.members).map((i) => props[i]).filter((p) => p.hasXY);
    if (!members.length) continue;
    const cosLat = Math.cos((z.lat * Math.PI) / 180);
    const X = members.map((p) => [p.lon * cosLat, p.lat]);
    const n = members.length;
    const k = n < 50 ? 1 : Math.max(2, Math.min(8, Math.round(Math.sqrt(n) / 4)));
    const rnd = mulberry32(1000 + z.id);
    const C = [X[Math.floor(rnd() * n)].slice()];
    while (C.length < k) { // k-means++
      const d = X.map((x) => Math.min(...C.map((c) => (x[0] - c[0]) ** 2 + (x[1] - c[1]) ** 2)));
      let r = rnd() * d.reduce((a, b) => a + b, 0), idx = 0;
      for (; idx < n - 1; idx++) { r -= d[idx]; if (r <= 0) break; }
      C.push(X[idx].slice());
    }
    const lab = new Int32Array(n);
    for (let it = 0; it < 40; it++) {
      let moved = false;
      for (let a = 0; a < n; a++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < k; c++) { const d = (X[a][0] - C[c][0]) ** 2 + (X[a][1] - C[c][1]) ** 2; if (d < bd) { bd = d; best = c; } }
        if (lab[a] !== best) { lab[a] = best; moved = true; }
      }
      const sum = Array.from({ length: k }, () => [0, 0, 0]);
      for (let a = 0; a < n; a++) { const s = sum[lab[a]]; s[0] += X[a][0]; s[1] += X[a][1]; s[2]++; }
      sum.forEach((s, c) => { if (s[2]) C[c] = [s[0] / s[2], s[1] / s[2]]; });
      if (!moved && it > 0) break;
    }
    const used = new Map<string, number>();
    for (let c = 0; c < k; c++) {
      const idxs: number[] = [];
      for (let a = 0; a < n; a++) if (lab[a] === c) idxs.push(a);
      if (!idxs.length) continue;
      let ci = idxs[0], bd = Infinity;
      for (const a of idxs) { const d = (X[a][0] - C[c][0]) ** 2 + (X[a][1] - C[c][1]) ** 2; if (d < bd) { bd = d; ci = a; } }
      const center = members[ci];
      let name = center.region || center.municipio || z.nombre;
      const times = (used.get(name) || 0) + 1;
      used.set(name, times);
      if (times > 1) name += " " + times;
      const sub: SubInfo = {
        id: subs.length, zone: z.id, nombre: name, municipio: center.municipio, lat: center.lat, lon: center.lon,
        members: Int32Array.from(idxs.map((a) => members[a].i)), single: k === 1
      };
      for (const i of sub.members) props[i].sub = sub.id;
      subs.push(sub);
    }
  }
  return subs;
}
