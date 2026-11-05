#!/usr/bin/env node
/**
 * Descarga las tarifas oficiales de CFE («Conoce tu tarifa») para TODOS los municipios de Tamaulipas
 * y las agrupa por nodo: municipios con la misma tabla de cargos (misma división tarifaria) forman un grupo.
 *
 *   npm i -D cheerio
 *   node scripts/scrape-tarifas-cfe.mjs                       # todas las tarifas de negocio/industria, desde 2025
 *   node scripts/scrape-tarifas-cfe.mjs --tarifas GDMTH,GDMTO,PDBT --desde 2025
 *   node scripts/scrape-tarifas-cfe.mjs --completo            # cada municipio y cada mes (más lento, sin agrupar)
 *
 * Salida: public/data/tarifas-cfe-tamaulipas.json  (lo lee src/dashboard/tarifas.ts)
 * Si una página no devuelve cargos, se guarda su HTML en scripts/.debug/ para revisar los selectores.
 */
import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DESDE = Number(arg("--desde", "2025"));
const OUT = arg("--out", "public/data/tarifas-cfe-tamaulipas.json");
const PAUSA = Number(arg("--pausa", "700"));
const COMPLETO = args.includes("--completo");
const SOLO = arg("--tarifas", "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const ESTADO = "TAMAULIPAS";

const RAIZ = "https://app.cfe.mx/Aplicaciones/CCFE/Tarifas/";
const INDICES = [RAIZ + "TarifasCRENegocio/Negocio.aspx", RAIZ + "TarifasCREIndustria/Industria.aspx"];
const SEMILLAS = {
  PDBT: RAIZ + "TarifasCRENegocio/Tarifas/PequenaDemandaBT.aspx",
  GDBT: RAIZ + "TarifasCRENegocio/Tarifas/GranDemandaBT.aspx",
  GDMTO: RAIZ + "TarifasCRENegocio/Tarifas/GranDemandaMTO.aspx",
  GDMTH: RAIZ + "TarifasCRENegocio/Tarifas/GranDemandaMTH.aspx"
};
/** Nombre → clave de tarifa (el orden importa: DIST antes que DIT) */
const NOMBRES = [
  [/PEQUENA ?DEMANDA.*B(AJA)? ?T/, "PDBT"], [/GRAN ?DEMANDA.*B(AJA)? ?T(ENSION)?$|GRANDEMANDABT/, "GDBT"],
  [/MEDIA ?TENSION ?HORARIA|GRANDEMANDAMTH|\bGDMTH\b/, "GDMTH"], [/MEDIA ?TENSION ?ORDINARIA|GRANDEMANDAMTO|\bGDMTO\b/, "GDMTO"],
  [/SUBTRANSMISION|\bDIST\b/, "DIST"], [/NIVEL ?TRANSMISION|\bDIT\b/, "DIT"],
  [/ALUMBRADO.*BAJA|\bAPBT\b/, "APBT"], [/ALUMBRADO.*MEDIA|\bAPMT\b/, "APMT"],
  [/RIEGO.*BAJA|\bRABT\b/, "RABT"], [/RIEGO.*MEDIA|\bRAMT\b/, "RAMT"]
];
const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const UA = "Mozilla/5.0 (tablero de recibos CFE, Gobierno de Tamaulipas; consulta de tarifas publicas)";

const norm = (s = "") => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const per = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
const mesDe = (t) => { const n = norm(t); const i = MESES.findIndex((m) => n.includes(m)); return i >= 0 ? i + 1 : 0; };
const placeholder = (o) => !o.t || /SELECC|ELIJA|^-+$|^TODOS?$/i.test(norm(o.t)) || ["", "0", "-1"].includes(o.v);

/* ── HTTP con cookies de sesión ASP.NET ── */
const jar = new Map();
async function pedir(url, form) {
  for (let intento = 1; ; intento++) {
    await dormir(PAUSA);
    try {
      const headers = { "User-Agent": UA, "Accept-Language": "es-MX,es;q=0.9", Referer: url };
      if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
      const r = await fetch(url, { method: form ? "POST" : "GET", headers, body: form ? new URLSearchParams(form).toString() : undefined });
      const sc = r.headers.getSetCookie?.() ?? (r.headers.get("set-cookie")?.split(/,(?=[^;]+?=)/) ?? []);
      for (const c of sc) { const kv = c.split(";")[0], i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (intento >= 4) throw new Error(`${url}: ${e.message}`);
      await dormir(1500 * intento);
    }
  }
}

/* ── Formulario WebForms: campos ocultos + selects con su tipo ── */
function tipoSelect(s) {
  const T = s.opts.map((o) => norm(o.t)), id = norm(s.n + " " + s.id);
  if (T.includes(ESTADO) || /ESTADO|ENTIDAD/.test(id)) return "estado";
  if (/MUNIC/.test(id)) return "municipio";
  if (T.filter((t) => MESES.some((m) => t.includes(m))).length >= 3 || /\bMES\b|DDLMES/.test(id)) return "mes";
  if (T.filter((t) => /^20\d\d$/.test(t)).length >= 1 || /ANIO|ANO\b|YEAR/.test(id)) return "anio";
  if (/DIVIS|REGION/.test(id)) return "division";
  return "otro";
}
function formulario($) {
  const campos = {}, selects = [];
  $("form input[name]").each((_, el) => {
    const t = ($(el).attr("type") || "text").toLowerCase();
    if (["submit", "button", "image", "checkbox", "radio", "file", "reset"].includes(t)) return;
    campos[$(el).attr("name")] = $(el).attr("value") ?? "";
  });
  $("form select[name]").each((_, el) => {
    const n = $(el).attr("name");
    const opts = $(el).find("option").map((_, o) => ({ v: $(o).attr("value") ?? $(o).text().trim(), t: $(o).text().trim(), sel: $(o).is("[selected]") })).get();
    const cur = (opts.find((o) => o.sel) ?? opts[0])?.v ?? "";
    campos[n] = cur;
    const s = { n, id: $(el).attr("id") || n, opts, cur };
    s.kind = tipoSelect(s);
    selects.push(s);
  });
  // Municipio: si no se reconoce por nombre, es el select posterior al de estado que no tiene otro tipo
  if (!selects.some((s) => s.kind === "municipio")) {
    const ie = selects.findIndex((s) => s.kind === "estado");
    const m = selects.slice(ie + 1).find((s) => s.kind === "otro");
    if (ie >= 0 && m) m.kind = "municipio";
  }
  return { campos, selects };
}
function coincide(kind, o, w) {
  if (placeholder(o)) return false;
  const t = norm(o.t);
  if (kind === "anio") return t === String(w.anio);
  if (kind === "mes") return mesDe(o.t) === w.mes && (!/20\d\d/.test(t) || t.includes(String(w.anio)));
  if (kind === "estado") return t === ESTADO;
  if (kind === "municipio") return t === norm(w.municipio);
  return false;
}
/** Abre la página y va eligiendo año → mes → estado → municipio con postbacks (__EVENTTARGET) */
async function navegar(url, want) {
  let $ = cheerio.load(await pedir(url));
  const hechos = new Set();
  for (let paso = 0; paso < 10; paso++) {
    const { campos, selects } = formulario($);
    const s = selects.find((x) => !hechos.has(x.kind) && want[x.kind] !== undefined && x.opts.some((o) => coincide(x.kind, o, want)));
    if (!s) break;
    hechos.add(s.kind);
    const o = s.opts.find((x) => coincide(s.kind, x, want));
    if (s.cur === o.v && o.sel) continue;
    campos[s.n] = o.v;
    $ = cheerio.load(await pedir(url, { ...campos, __EVENTTARGET: s.n, __EVENTARGUMENT: "" }));
  }
  return { $, ...formulario($), hechos };
}

/* ── Lectura de la tabla de cargos ── */
const CONCEPTOS = [
  [/SUMINISTRO/, "suministro"], [/\bFIJO\b/, "fijo"], [/TRANSMISION/, "transmision"], [/DISTRIBUCION/, "distribucion"],
  [/CENACE/, "cenace"], [/SCNMEM|SERVICIOS CONEXOS/, "scnmem"], [/CAPACIDAD/, "capacidad"], [/ENERGIA|GENERACION/, "energia"]
];
const HORARIOS = [[/SEMIPUNTA/, "semipunta"], [/\bPUNTA\b/, "punta"], [/INTERMEDIA/, "intermedia"], [/\bBASE\b/, "base"]];
const num = (s) => { const x = s.replace(/[$\s]/g, "").replace(/,/g, ""); return /^-?\d*\.?\d+$/.test(x) ? Number(x) : NaN; };
function leerCargos($) {
  const cargos = {};
  let ultimo = "";
  $("table tr").each((_, tr) => {
    const celdas = $(tr).find("td,th").map((_, c) => $(c).text().replace(/\s+/g, " ").trim()).get();
    const fila = norm(celdas.join(" "));
    const mu = fila.match(/\$ ?\/ ?(KWH|KW|MES)\b/);
    const concepto = CONCEPTOS.find(([re]) => re.test(fila))?.[1] ?? (HORARIOS.some(([re]) => re.test(fila)) && ultimo === "energia" ? "energia" : ultimo);
    if (concepto) ultimo = concepto;
    if (!mu || !concepto) return;
    const valores = celdas.map(num).filter((x) => Number.isFinite(x));
    if (!valores.length) return;
    const u = mu[1] === "KWH" ? "$/kWh" : mu[1] === "KW" ? "$/kW" : "$/mes";
    const h = concepto === "energia" ? HORARIOS.find(([re]) => re.test(fila))?.[1] : undefined;
    const k = h ? `energia_${h}` : concepto;
    if (!cargos[k]) cargos[k] = { v: valores[valores.length - 1], u };
  });
  return cargos;
}
function leerDivision($, selects) {
  const s = selects.find((x) => x.kind === "division");
  const o = s?.opts.find((x) => x.sel && !placeholder(x));
  if (o) return o.t.trim();
  const m = norm($("body").text()).match(/DIVISION(?: TARIFARIA)?\s*:?\s*([A-Z ]{4,40}?)(?=\s{1,}|$|TARIFA|MES|\d)/);
  return m ? m[1].trim() : "";
}
async function consulta(url, w) {
  let { $, selects, campos } = await navegar(url, w);
  let cargos = leerCargos($);
  if (!Object.keys(cargos).length) {
    const btn = $("form input[type=submit][name], form button[type=submit][name]").first();
    if (btn.length) {
      $ = cheerio.load(await pedir(url, { ...campos, [btn.attr("name")]: btn.attr("value") ?? "", __EVENTTARGET: "", __EVENTARGUMENT: "" }));
      ({ selects } = formulario($)); cargos = leerCargos($);
    }
  }
  return { cargos, division: leerDivision($, selects), html: $.html() };
}

/* ── Descubrimiento de páginas de tarifa ── */
async function descubrir() {
  const paginas = { ...SEMILLAS };
  for (const idx of INDICES) {
    try {
      const $ = cheerio.load(await pedir(idx));
      $("a[href]").each((_, a) => {
        const href = new URL($(a).attr("href"), idx).href;
        if (!/\/Tarifas\/[^/]+\.aspx/i.test(href)) return;
        const txt = norm($(a).text() + " " + href.split("/").pop().replace(".aspx", ""));
        const cod = NOMBRES.find(([re]) => re.test(txt))?.[1] ?? norm(href.split("/").pop().replace(/\.aspx$/i, ""));
        if (!paginas[cod] || paginas[cod] === SEMILLAS[cod]) paginas[cod] = href;
      });
    } catch (e) { console.warn("  índice no disponible:", e.message); }
  }
  return Object.fromEntries(Object.entries(paginas).filter(([k]) => !SOLO.length || SOLO.includes(k)));
}

async function periodos(url) {
  const { selects } = await navegar(url, {});
  const sA = selects.find((s) => s.kind === "anio"), out = [];
  if (sA) {
    for (const y of sA.opts.map((o) => Number(norm(o.t))).filter((y) => y >= DESDE)) {
      const r = await navegar(url, { anio: y });
      for (const o of r.selects.find((s) => s.kind === "mes")?.opts ?? []) { const m = mesDe(o.t); if (m) out.push(per(y, m)); }
    }
  } else {
    for (const o of selects.find((s) => s.kind === "mes")?.opts ?? []) {
      const m = mesDe(o.t), y = Number(norm(o.t).match(/20\d\d/)?.[0]);
      if (m && y >= DESDE) out.push(per(y, m));
    }
  }
  const hoy = new Date(), lim = per(hoy.getFullYear(), hoy.getMonth() + 1);
  return [...new Set(out)].filter((p) => p <= lim).sort();
}
const wPer = (p) => ({ anio: Number(p.slice(0, 4)), mes: Number(p.slice(5)) });
const huella = (r) => r.division + "|" + JSON.stringify(Object.entries(r.cargos).sort());

async function guardar(obj) { await mkdir(dirname(OUT), { recursive: true }); await writeFile(OUT, JSON.stringify(obj, null, 1)); }
async function depurar(cod, html) { await mkdir("scripts/.debug", { recursive: true }); await writeFile(`scripts/.debug/${cod}.html`, html); }

const res = { generado: new Date().toISOString(), estado: "Tamaulipas", fuente: "CFE · Conoce tu tarifa (app.cfe.mx/Aplicaciones/CCFE/Tarifas)", desde: DESDE, tarifas: {} };
const paginas = await descubrir();
console.log("Tarifas a consultar:", Object.keys(paginas).join(", "));

for (const [cod, url] of Object.entries(paginas)) {
  try {
    console.log(`\n${cod} · ${url}`);
    const pers = await periodos(url);
    if (!pers.length) { console.warn("  sin periodos ≥", DESDE); continue; }
    const ult = pers[pers.length - 1];
    console.log(`  periodos: ${pers[0]} … ${ult} (${pers.length})`);
    const { selects } = await navegar(url, { ...wPer(ult), estado: ESTADO });
    const muns = (selects.find((s) => s.kind === "municipio")?.opts ?? []).filter((o) => !placeholder(o)).map((o) => o.t.trim());
    const lista = muns.length ? muns : ["*"]; // tarifa sin selección de municipio: una sola tabla estatal
    console.log(`  municipios de Tamaulipas: ${muns.length || "no aplica (tabla única)"}`);

    // 1) Último mes en cada municipio → grupos por tabla idéntica (nodo / división)
    const grupos = new Map();
    for (const mu of lista) {
      const r = await consulta(url, { ...wPer(ult), estado: ESTADO, ...(mu === "*" ? {} : { municipio: mu }) });
      if (!Object.keys(r.cargos).length) { console.warn(`  ${mu}: sin cargos`); await depurar(`${cod}-${norm(mu).replace(/\W+/g, "_")}`, r.html); continue; }
      const k = COMPLETO ? mu : huella(r);
      let g = grupos.get(k);
      if (!g) grupos.set(k, (g = { id: `${cod}-${grupos.size + 1}`, division: r.division || (COMPLETO ? mu : `Nodo ${grupos.size + 1}`), municipios: [], meses: { [ult]: r.cargos }, rep: mu }));
      g.municipios.push(mu);
      process.stdout.write(`  ${mu} → ${g.division}\n`);
    }
    // 2) Todos los meses para el municipio representativo de cada grupo
    for (const g of grupos.values()) {
      for (const p of pers) {
        if (g.meses[p]) continue;
        const r = await consulta(url, { ...wPer(p), estado: ESTADO, ...(g.rep === "*" ? {} : { municipio: g.rep }) });
        if (Object.keys(r.cargos).length) g.meses[p] = r.cargos; else console.warn(`  ${g.division} ${p}: sin cargos`);
      }
      console.log(`  ${g.division}: ${g.municipios.length} municipios, ${Object.keys(g.meses).length} meses`);
    }
    res.tarifas[cod] = { url, grupos: [...grupos.values()].map(({ rep, ...g }) => g) };
    await guardar(res);
  } catch (e) {
    console.error(`  ${cod}: ${e.message}`);
  }
}
await guardar(res);
console.log(`\nListo → ${OUT}`);
