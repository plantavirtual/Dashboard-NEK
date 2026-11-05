import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MLMap } from "maplibre-gl";
import { STATE_BBOX, VIEW2, VIEW3, ZOOM_CALLES } from "../lib/constants";
import { useStore } from "../store";
import { baseStyle } from "./mapStyle";
import { fitPadding, type OverlayEngine } from "./overlayEngine";
import { addPointLayers, filterPoints, pointsUrl, setHoverPointFilter, setPointsVisible, setSelectedFilter, stylePoints } from "./points";
import { instalarMapaBase } from "./basemap";
import { usePointInteractions } from "./usePointInteractions";
import { Overlay } from "../components/Overlay";
import { ZoomControls } from "../components/ZoomControls";
import { HoverCard } from "../components/HoverCard";
import { BottomPanel } from "../components/BottomPanel";
import { SidePanel } from "../components/SidePanel";
import { Toast } from "../components/Toast";

export function MapStage() {
  const boxRef = useRef<HTMLDivElement>(null);
  const [mc, setMc] = useState<{ map: MLMap; fitZoom: number } | null>(null);
  const [engine, setEngine] = useState<OverlayEngine | null>(null);
  const onEngine = useCallback((e: OverlayEngine | null) => setEngine(e), []);
  const lastUrl = useRef<string | null>(null);

  const model = useStore((s) => s.model);
  const colorBy = useStore((s) => s.colorBy);
  const month = useStore((s) => s.month);
  const dep = useStore((s) => s.dep);
  const fin = useStore((s) => s.fin);
  const hoverKey = useStore((s) => s.hoverKey);
  const hoverPoint = useStore((s) => s.hoverPoint);
  const selected = useStore((s) => s.selected);
  const ptsOn = useStore((s) => s.ptsOn);
  const map = mc?.map ?? null;
  const [pointsReady, setPointsReady] = useState(false);

  // 1) El mapa se crea de inmediato, en paralelo con la descarga de datos
  useEffect(() => {
    const m = new maplibregl.Map({
      container: boxRef.current!, style: baseStyle(),
      bounds: [[STATE_BBOX[0], STATE_BBOX[1]], [STATE_BBOX[2], STATE_BBOX[3]]], fitBoundsOptions: { padding: fitPadding() },
      maxZoom: 16, maxBounds: [[-106.5, 17], [-89, 31.5]],
      attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Límites: INEGI 2022 · Natural Earth · Uso de suelo: INEGI Serie V" }), "bottom-right");
    const updateView = () => {
      const z = m.getZoom();
      useStore.getState().setView(z < VIEW2 ? 1 : z < VIEW3 ? 2 : 3);
    };
    m.once("load", () => {
      const fitZoom = m.getZoom();
      m.setMinZoom(Math.max(3.5, fitZoom - 1.2));
      updateView();
      m.on("move", updateView);
      setMc({ map: m, fitZoom });
      // El mapa de calles va al final para no retrasar el resto; sin tamaulipas.pmtiles el mapa sigue sin calles
      void instalarMapaBase(m, { archivo: "tamaulipas.pmtiles", recursos: "basemap-assets", zoomCalles: ZOOM_CALLES, tipografia: "Lato" });
    });
    return () => { m.remove(); setMc(null); setPointsReady(false); };
  }, []);

  // 2) Puntos: la fuente se agrega o se reemplaza cuando llega un modelo nuevo
  useEffect(() => {
    if (!map || !model) return;
    const url = pointsUrl(model);
    addPointLayers(map, url);
    setPointsReady(true);
    const old = lastUrl.current;
    lastUrl.current = url;
    if (old && old !== url) setTimeout(() => URL.revokeObjectURL(old), 30_000);
  }, [map, model]);

  // 3) Estilo y filtros: solo cambian expresiones, nunca los datos
  useEffect(() => { if (map && model && pointsReady) stylePoints(map, model, colorBy, month); }, [map, model, pointsReady, colorBy, month]);
  useEffect(() => { if (map && model && pointsReady) filterPoints(map, model, colorBy, dep, fin, hoverKey); }, [map, model, pointsReady, colorBy, dep, fin, hoverKey]);
  useEffect(() => { if (map && pointsReady) setHoverPointFilter(map, hoverPoint); }, [map, pointsReady, hoverPoint]);
  useEffect(() => { if (map && pointsReady) setSelectedFilter(map, selected); }, [map, pointsReady, selected]);
  useEffect(() => { if (map && pointsReady) setPointsVisible(map, ptsOn); }, [map, pointsReady, ptsOn]);

  usePointInteractions(map, engine, pointsReady);

  return (
    <main id="mapWrap">
      <div id="map" ref={boxRef} />
      {mc && <Overlay map={mc.map} fitZoom={mc.fitZoom} onEngine={onEngine} />}
      <ZoomControls map={map} />
      <HoverCard map={map} />
      <BottomPanel />
      <SidePanel />
      <Toast />
    </main>
  );
}
