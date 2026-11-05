import type { StyleSpecification } from "maplibre-gl";
import { SUELO_ZOOM, USO_SUELO } from "../lib/constants";
import { assetUrl } from "./assets";

/** Estilo base: solo límites y uso de suelo. Los GeoJSON van por URL, así MapLibre los procesa en su worker y
    el mapa se ve antes de que lleguen los datos de Supabase. */
export function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      neigh: { type: "geojson", data: assetUrl("data/vecinos.json") },
      state: { type: "geojson", data: assetUrl("data/estado.json") },
      mun: { type: "geojson", data: assetUrl("data/municipios.json") },
      ...Object.fromEntries(USO_SUELO.map((u) => [u.id, { type: "image", url: assetUrl(u.url), coordinates: u.coordinates }]))
    },
    layers: [
      { id: "neigh-fill", type: "fill", source: "neigh", paint: { "fill-color": "#ecebe6" } },
      { id: "neigh-line", type: "line", source: "neigh", paint: { "line-color": "#ffffff", "line-width": 1.2 } },
      { id: "state-shadow-far", type: "fill", source: "state", paint: { "fill-color": "#343a62", "fill-opacity": 0.05, "fill-translate": [3, 7] } },
      { id: "state-shadow-mid", type: "fill", source: "state", paint: { "fill-color": "#343a62", "fill-opacity": 0.06, "fill-translate": [1.5, 3.5] } },
      { id: "state-shadow-near", type: "fill", source: "state", paint: { "fill-color": "#343a62", "fill-opacity": 0.08, "fill-translate": [0.5, 1.5] } },
      { id: "mun-fill", type: "fill", source: "mun", paint: { "fill-color": "#fbfaf7" } },
      ...USO_SUELO.map((u) => ({
        id: u.id, type: "raster" as const, source: u.id,
        paint: {
          "raster-opacity": ["interpolate", ["linear"], ["zoom"], SUELO_ZOOM[0], 0.92, SUELO_ZOOM[1], 0] as any,
          "raster-fade-duration": 0, "raster-resampling": "linear" as const
        }
      })),
      { id: "mun-tint", type: "fill", source: "mun", filter: ["in", ["get", "cve"], ["literal", []]], paint: { "fill-color": "#7b8cde", "fill-opacity": 0.13 } },
      { id: "mun-line", type: "line", source: "mun", paint: { "line-color": "#e2dfd6", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.7, 11, 1.4] } },
      { id: "state-line", type: "line", source: "state", paint: { "line-color": "#aab0c6", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 11, 2] } }
    ]
  };
}
