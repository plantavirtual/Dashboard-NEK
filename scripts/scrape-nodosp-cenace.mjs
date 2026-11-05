#!/usr/bin/env node
/**
 * Descarga la versión más reciente del Catálogo de NodosP del CENACE y extrae los de Tamaulipas.
 *
 *   npm i -D xlsx
 *   node scripts/scrape-nodosp-cenace.mjs              # solo Tamaulipas
 *   node scripts/scrape-nodosp-cenace.mjs --todo       # todo el Sistema Eléctrico Nacional
 *   node scripts/scrape-nodosp-cenace.mjs --diag       # además guarda una muestra en scripts/.debug/
 *   node scripts/scrape-nodosp-cenace.mjs --archivo "C:\ruta\catalogo.xlsx"   # usar un Excel ya descargado
 *
 * Salida: public/data/nodosp-tamaulipas.json  (lo lee src/dashboard/tarifas.ts)
 */
import * as XLSX from "xlsx";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = arg("--out", "public/data/nodosp-tamaulipas.json");
const ARCHIVO = arg("--archivo", "");
const TODO = args.includes("--todo"), DIAG = args.includes("--diag");
const PAGINA = "https://www.cenace.gob.mx/Paginas/SIM/NodosP.aspx";
const norm = (s = "") => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

const ESTADOS = ["AGUASCALIENTES", "BAJA CALIFORNIA", "BAJA CALIFORNIA SUR", "CAMPECHE", "CHIAPAS", "CHIHUAHUA", "CIUDAD DE MEXICO", "DISTRITO FEDERAL",
  "COAHUILA", "COAHUILA DE ZARAGOZA", "COLIMA", "DURANGO", "GUANAJUATO", "GUERRERO", "HIDALGO", "JALISCO", "MEXICO", "ESTADO DE MEXICO", "MICHOACAN",
  "MICHOACAN DE OCAMPO", "MORELOS", "NAYARIT", "NUEVO LEON", "OAXACA", "PUEBLA", "QUERETARO", "QUINTANA ROO", "SAN LUIS POTOSI", "SINALOA", "SONORA",
  "TABASCO", "TAMAULIPAS", "TLAXCALA", "VERACRUZ", "VERACRUZ DE IGNACIO DE LA LLAVE", "YUCATAN", "ZACATECAS"];
const esTamaulipas = (s) => { const n = norm(s); return n === "TAMPS" || n === "TAMPS." || n.includes("TAMAULIPAS"); };
const CLAVE_TAM = 28; // INEGI

/* ── Descarga (o archivo local) ── */
let buf, version = "", fuente = "";
if (ARCHIVO) {
  buf = await readFile(ARCHIVO); fuente = PAGINA;
  version = basename(ARCHIVO).match(/v?(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
  console.log("Leyendo", ARCHIVO);
} else {
  const html = await (await fetch(PAGINA, { headers: { "User-Agent": "Mozilla/5.0 (tablero CFE Tamaulipas)" } })).text();
  const links = [...html.matchAll(/href="([^"]*CatalogoNodosP[^"]*\.xlsx)"/gi)]
    .map((m) => new URL(m[1].replace(/&amp;/g, "&"), PAGINA).href)
    .map((u) => ({ u, v: decodeURIComponent(u).match(/\(v?(\d{4}-\d{2}-\d{2})\)/)?.[1] ?? "" }))
    .sort((a, b) => b.v.localeCompare(a.v));
  if (!links.length) throw new Error("No se encontraron archivos .xlsx en " + PAGINA);
  ({ u: fuente, v: version } = links[0]);
  console.log("Descargando", decodeURIComponent(fuente));
  const r = await fetch(fuente);
  if (!r.ok) throw new Error(`HTTP ${r.status} al descargar el catálogo`);
  buf = Buffer.from(await r.arrayBuffer());
}
const wb = XLSX.read(buf, { type: "buffer" });

/* ── Detección de columnas ── */
const REGLAS = {
  clave: [/^CLAVE$/], nombre: [/^NOMBRE$/], sistema: [/^SISTEMA$/], ccr: [/^CENTRO DE CONTROL/], zonaCarga: [/^ZONA DE CARGA$/],
  tension: [/^NIVEL DE TENSION/, /TENSION/],
  zonaTrans: [/^ZONA DE OPERACION DE TRANSMISION/], zonaDist: [/^ZONA DE DISTRIBUCION/], division: [/^GERENCIA DIVISIONAL DE DISTRIBUCION/],
  claveEnt: [/^CLAVE DE ENTIDAD/], estado: [/^ENTIDAD FEDERATIVA/, /^ESTADO$/],
  claveMun: [/^CLAVE DE MUNICIPIO/], municipio: [/^MUNICIPIO/],
  region: [/^REGION DE TRANSMISION/, /^REGION/]
};
const buscar = (enc, reglas, usadas) => { for (const re of reglas) { const i = enc.findIndex((c, j) => !usadas.has(j) && re.test(c)); if (i >= 0) return i; } return -1; };
/** La columna de estado se elige por su contenido: la que más celdas tiene con nombres de entidades */
function columnaEstado(datos, ancho) {
  let mejor = -1, max = 0;
  for (let i = 0; i < ancho; i++) {
    let n = 0; for (const f of datos) if (ESTADOS.includes(norm(f[i]))) n++;
    if (n > max) { max = n; mejor = i; }
  }
  return max >= 5 ? mejor : -1;
}

const nodos = [];
for (const hoja of wb.SheetNames) {
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, defval: "", raw: false });
  const h = filas.findIndex((f) => f.some((c) => /^CLAVE/.test(norm(c))) && f.some((c) => /MUNICIPIO|ESTADO|ENTIDAD|ZONA DE CARGA/.test(norm(c))));
  if (h < 0) { console.log(`  hoja «${hoja}»: sin encabezado reconocible, se omite`); continue; }
  // Encabezado en una o dos filas (celdas combinadas): se completa con la fila de arriba y la de abajo
  const ancho = Math.max(...filas.slice(h, h + 3).map((f) => f.length));
  const enc = Array.from({ length: ancho }, (_, i) => norm(filas[h][i]) || norm(filas[h + 1]?.[i] ?? "") || norm(filas[h - 1]?.[i] ?? ""));
  let ini = h + 1;
  if (filas[ini] && filas[ini].filter((c) => norm(c)).every((c) => /^[A-Z ()./]+$/.test(norm(c)) && !ESTADOS.includes(norm(c)))) ini++; // segunda fila de encabezado
  const datos = filas.slice(ini);

  const usadas = new Set(), idx = {};
  for (const [k, reglas] of Object.entries(REGLAS)) { idx[k] = buscar(enc, reglas, usadas); if (idx[k] >= 0) usadas.add(idx[k]); }
  const porContenido = columnaEstado(datos.slice(0, 2000), ancho);
  if (porContenido >= 0 && porContenido !== idx.estado) {
    console.log(`  la columna de estado por encabezado era «${enc[idx.estado] ?? "—"}»; por contenido es «${enc[porContenido]}»: se usa esta`);
    idx.estado = porContenido;
  }
  const val = (f, k) => (idx[k] >= 0 ? String(f[idx[k]] ?? "").trim() : "");

  console.log(`  hoja «${hoja}»: encabezado en fila ${h + 1}, datos desde fila ${ini + 1}`);
  for (const [k, i] of Object.entries(idx)) console.log(`    ${k.padEnd(10)} ← ${i >= 0 ? `col ${i + 1} «${enc[i]}»` : "no encontrada"}`);
  const cuenta = new Map(); for (const f of datos) { const e = val(f, "estado") || "(vacío)"; cuenta.set(e, (cuenta.get(e) ?? 0) + 1); }
  console.log("    valores de estado más frecuentes:", [...cuenta].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([e, n]) => `${e} (${n})`).join(", "));
  if (DIAG) {
    await mkdir("scripts/.debug", { recursive: true });
    await writeFile(`scripts/.debug/nodosp-${hoja.replace(/\W+/g, "_")}.json`, JSON.stringify({ encabezado: enc, muestra: filas.slice(Math.max(0, h - 2), ini + 15) }, null, 1));
  }

  let n = 0;
  for (const f of datos) {
    const clave = val(f, "clave");
    if (!clave) continue;
    const estado = val(f, "estado");
    // Si no hay columna de estado reconocible, basta con que alguna celda de la fila diga Tamaulipas
    const enTam = idx.estado >= 0 ? esTamaulipas(estado) || Number(val(f, "claveEnt")) === CLAVE_TAM
      : idx.claveEnt >= 0 ? Number(val(f, "claveEnt")) === CLAVE_TAM : f.some(esTamaulipas);
    if (!TODO && !enTam) continue;
    nodos.push({ clave, nombre: val(f, "nombre"), tipo: /DISTRIBU/i.test(hoja) ? "Distribuido" : "NodoP", sistema: val(f, "sistema"), ccr: val(f, "ccr"),
      zonaCarga: val(f, "zonaCarga"), tension: val(f, "tension"), estado: estado || "TAMAULIPAS", municipio: val(f, "municipio"), claveMun: val(f, "claveMun"),
      region: val(f, "region"), zonaTrans: val(f, "zonaTrans"), zonaDist: val(f, "zonaDist"), division: val(f, "division") });
    n++;
  }
  console.log(`    → ${n} nodos ${TODO ? "en total" : "de Tamaulipas"}`);
}
if (!nodos.length) {
  throw new Error("El catálogo no trajo nodos de Tamaulipas. Corre de nuevo con --diag y envía la salida y el archivo scripts/.debug/nodosp-*.json.");
}
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ generado: new Date().toISOString(), version: version || "sin versión", fuente, nodos }, null, 1));
console.log(`Listo → ${OUT} (${nodos.length} nodos, versión ${version})`);
