import type { Map as MLMap } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import { assetUrl } from "./assets";

interface Opciones { archivo: string; recursos: string; zoomCalles: number; idioma?: string; tipografia?: "Lato" | "Noto Sans" }
let protocolo: unknown = null;

/** Mapa de calles (Protomaps / OpenStreetMap) desde el zoom indicado. Se carga después del resto del mapa:
    pmtiles y @protomaps/basemaps viajan en su propio trozo de JavaScript. Devuelve true si se instaló. */
export async function instalarMapaBase(map: MLMap, o: Opciones): Promise<boolean> {
  const url = assetUrl(o.archivo);
  // ¿Existe el archivo y el servidor permite lecturas parciales (Range)? Indispensable para .pmtiles
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-6" } });
    if (r.status !== 206 || (await r.text()) !== "PMTiles") {
      console.warn("Mapa base no disponible, o el servidor no admite lecturas parciales (Range):", url);
      return false;
    }
  } catch (e) { console.warn("Mapa base no disponible:", url, e); return false; }

  const [{ Protocol }, basemaps] = await Promise.all([import("pmtiles"), import("@protomaps/basemaps")]);
  if (!protocolo) {
    const p = new Protocol();
    protocolo = p;
    maplibregl.addProtocol("pmtiles", p.tile);
  }
  const rec = assetUrl(o.recursos.replace(/\/?$/, "/"));
  map.setGlyphs(rec + "fonts/{fontstack}/{range}.pbf");
  map.setSprite(rec + "sprites/v4/white");
  map.addSource("protomaps", {
    type: "vector", url: "pmtiles://" + url,
    attribution: '<a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · Protomaps'
  });

  // Paleta sobria: tierra cálida clara, agua azul grisácea, calles blancas con borde suave
  const fl = Object.assign({}, basemaps.namedFlavor("white"), {
    background: "#dbe4ee", earth: "#f4f3ef", water: "#dbe4ee",
    park_a: "#e9ede2", park_b: "#e9ede2", wood_a: "#e9ede2", wood_b: "#e9ede2", scrub_a: "#eeede6", scrub_b: "#eeede6",
    buildings: "#e6e3dc", pier: "#e6e3dc", runway: "#e6e3dc",
    highway: "#ffffff", highway_casing_early: "#d4d2ca", highway_casing_late: "#d4d2ca",
    major: "#ffffff", major_casing_early: "#dcdad2", major_casing_late: "#dcdad2",
    link: "#ffffff", link_casing: "#dcdad2", minor_a: "#ffffff", minor_b: "#ffffff", minor_casing: "#e4e2da",
    minor_service: "#fbfaf7", minor_service_casing: "#e7e5de", other: "#f6f5f1",
    bridges_highway: "#ffffff", bridges_major: "#ffffff", bridges_minor: "#ffffff", bridges_link: "#ffffff", bridges_other: "#f6f5f1",
    bridges_highway_casing: "#d4d2ca", bridges_major_casing: "#dcdad2", bridges_minor_casing: "#e4e2da", bridges_link_casing: "#dcdad2", bridges_other_casing: "#e4e2da",
    railway: "#d4d2ca", boundaries: "#b9bccb",
    city_label: "#3d4157", city_label_halo: "#ffffff", subplace_label: "#7c8098", subplace_label_halo: "#ffffff",
    roads_label_major: "#6e7290", roads_label_major_halo: "#ffffff", roads_label_minor: "#8a8ea6", roads_label_minor_halo: "#ffffff"
  });

  const quitar = new Set(["background", "places_region", "places_country", "water_label_ocean", "roads_oneway", "address_label"]);
  const capas: any[] = basemaps.layers("protomaps", fl as any, { lang: o.idioma ?? "es" }).filter((l: any) => !quitar.has(l.id));
  if ((o.tipografia ?? "Lato") === "Lato") {
    // Lato no tiene "Medium": se usa Lato Bold
    const equiv: Record<string, string> = { "Noto Sans Regular": "Lato Regular", "Noto Sans Medium": "Lato Bold", "Noto Sans Italic": "Lato Italic" };
    for (const l of capas) {
      if (l.layout?.["text-font"]) {
        let t = JSON.stringify(l.layout["text-font"]);
        for (const [a, b] of Object.entries(equiv)) t = t.split(a).join(b);
        l.layout["text-font"] = JSON.parse(t);
      }
    }
  }
  // Las calles quedan debajo de la capa de puntos si ya existe; si no, los puntos se agregan después y quedan encima
  const antes = map.getLayer("pts") ? "pts" : undefined;
  for (const l of capas) {
    l.id = "pm_" + l.id;
    l.minzoom = Math.max(l.minzoom || 0, o.zoomCalles);
    map.addLayer(l, antes);
  }
  return true;
}
