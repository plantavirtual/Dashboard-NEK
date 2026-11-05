import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import { NODATA } from "../lib/constants";
import { isCatMode, measureOf } from "../lib/selectors";
import type { CatMode, ColorBy, Model } from "../data/types";

type Expr = any;
export const PT_LAYERS = ["pts", "pts-feat", "pts-hl", "pts-hover", "pts-sel"];
const NONE: Expr = ["==", ["get", "i"], -1];

/* Una sola fuente GeoJSON para toda la sesión. Cada punto lleva la clase de color de cada mes (k0.., p0.., w0..)
   y su categoría; cambiar mes, medida o filtros solo reemplaza expresiones del estilo: no se vuelve a generar
   ni a cortar en teselas ningún dato. */

const blobUrls = new WeakMap<Model, string>();
export function pointsUrl(model: Model): string {
  let u = blobUrls.get(model);
  if (!u) {
    u = URL.createObjectURL(new Blob([model.pointsJson], { type: "application/json" }));
    blobUrls.set(model, u);
    model.pointsJson = "";   // el texto ya vive en el Blob: se libera la copia en memoria
  }
  return u;
}

export function addPointLayers(map: MLMap, url: string) {
  if (map.getSource("pts")) { (map.getSource("pts") as GeoJSONSource).setData(url); return; }
  map.addSource("pts", { type: "geojson", data: url });
  const col: Expr = NODATA;
  map.addLayer({ id: "pts", type: "circle", source: "pts", paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 5.6, 2.4, 8.5, 3.6, 13, 6, 16, 8],
    "circle-color": col
  } });
  map.addLayer({ id: "pts-feat", type: "circle", source: "pts", filter: ["==", ["get", "f"], -1], paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 5.6, 4.2, 8.5, 5.4, 13, 8, 16, 10],
    "circle-color": col, "circle-opacity": 1, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.6 } });
  map.addLayer({ id: "pts-hl", type: "circle", source: "pts", filter: ["==", ["get", "z"], -999], paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 5.6, 3.4, 8.5, 4.8, 13, 7.5, 16, 9.5],
    "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#4f5fb8",
    "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 5.6, 1, 13, 1.6] } });
  map.addLayer({ id: "pts-hover", type: "circle", source: "pts", filter: NONE, paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 8.5, 6, 16, 11],
    "circle-color": col, "circle-opacity": 1, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
  map.addLayer({ id: "pts-sel", type: "circle", source: "pts", filter: NONE, paint: {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 5.6, 6, 13, 10, 16, 13],
    "circle-color": col, "circle-opacity": 1, "circle-stroke-color": "#7b8cde", "circle-stroke-width": 3.5 } });
}

const CAT_KEY: Record<CatMode, string> = { dependencia: "cd", tarifa: "ct", interconexion: "ci", ubicacion: "cu" };
const PREFIX = { consumo: "k", precio: "p", demanda: "w" } as const;

function colorExpr(model: Model, colorBy: ColorBy, month: number): Expr {
  if (isCatMode(colorBy)) {
    const arms = model.cats[colorBy].colors.flatMap((c, i) => [i, c]);
    return arms.length ? ["match", ["get", CAT_KEY[colorBy]], ...arms, NODATA] : NODATA;
  }
  const m = measureOf(colorBy);
  const arms = model.scales[m].colors.flatMap((c, i) => [i, c]);
  return ["case", ["==", ["get", "h"], 0], "#ffffff", ["match", ["get", PREFIX[m] + month], -1, NODATA, ...arms, NODATA]];
}

export function stylePoints(map: MLMap, model: Model, colorBy: ColorBy, month: number) {
  const color = colorExpr(model, colorBy, month);
  for (const id of ["pts", "pts-feat", "pts-hover", "pts-sel"]) map.setPaintProperty(id, "circle-color", color);
  const cat = isCatMode(colorBy);
  const noHist: Expr = ["==", ["get", "h"], 0];
  map.setPaintProperty("pts", "circle-opacity", cat ? 0.85 : ["case", noHist, 0.95, 0.62]);
  map.setPaintProperty("pts", "circle-stroke-color", cat ? "#ffffff" : ["case", noHist, "#a7aab8", "#ffffff"]);
  map.setPaintProperty("pts", "circle-stroke-width", cat
    ? ["interpolate", ["linear"], ["zoom"], 9, 0, 11, 0.8, 16, 1.2]
    : ["interpolate", ["linear"], ["zoom"], 9, ["case", noHist, 1, 0], 11, ["case", noHist, 1, 0.8], 16, ["case", noHist, 1.2, 1.2]]);
}

export function filterParts(model: Model, dep: string, fin: string): Expr[] {
  const parts: Expr[] = [];
  if (dep) parts.push(["==", ["get", "cd"], model.deps.indexOf(dep)]);
  if (fin === "enefeb") parts.push(["in", ["get", "e"], ["literal", [1, 2]]]);
  else if (fin === "2026-01") parts.push(["==", ["get", "e"], 1]);
  else if (fin === "2026-02") parts.push(["==", ["get", "e"], 2]);
  else if (fin === "otro") parts.push(["==", ["get", "e"], 0]);
  return parts;
}
const all = (parts: Expr[]): Expr | null => (parts.length ? ["all", ...parts] : null);

export function filterPoints(map: MLMap, model: Model, colorBy: ColorBy, dep: string, fin: string, hoverKey: string | null) {
  const parts = filterParts(model, dep, fin);
  map.setFilter("pts", all(parts));
  map.setFilter("pts-feat", colorBy === "interconexion" ? ["all", ["==", ["get", "f"], 1], ...parts] : ["==", ["get", "f"], -1]);
  // Resaltado de la zona o subgrupo bajo el cursor (y sus municipios)
  let hl: Expr = ["==", ["get", "z"], -999], cves: string[] = [];
  if (hoverKey) {
    const id = +hoverKey.slice(1);
    if (hoverKey[0] === "z") { hl = ["all", ["==", ["get", "z"], id], ...parts]; cves = model.zones.find((z) => z.id === id)?.cves ?? []; }
    else hl = ["all", ["==", ["get", "s"], id], ...parts];
  }
  map.setFilter("pts-hl", hl);
  map.setFilter("mun-tint", ["in", ["get", "cve"], ["literal", cves]]);
}

export const setHoverPointFilter = (map: MLMap, i: number) => map.setFilter("pts-hover", i < 0 ? NONE : ["==", ["get", "i"], i]);
export const setSelectedFilter = (map: MLMap, i: number) => map.setFilter("pts-sel", i < 0 ? NONE : ["==", ["get", "i"], i]);
export function setPointsVisible(map: MLMap, on: boolean) {
  for (const l of PT_LAYERS) if (map.getLayer(l)) map.setLayoutProperty(l, "visibility", on ? "visible" : "none");
}
