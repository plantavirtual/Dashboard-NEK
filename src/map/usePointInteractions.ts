import { useEffect } from "react";
import type { Map as MLMap, MapMouseEvent } from "maplibre-gl";
import { useStore } from "../store";
import type { OverlayEngine } from "./overlayEngine";

/** Abre el panel lateral y, si el punto queda tapado por él, desplaza el mapa */
export function selectPoint(map: MLMap, i: number) {
  const { model, select } = useStore.getState();
  select(i);
  const p = model?.props[i];
  if (!p?.hasXY) return;
  const pt = map.project([p.lon, p.lat]);
  const W = map.getContainer().clientWidth, H = map.getContainer().clientHeight;
  if (innerWidth > 760) {
    const limit = W - document.getElementById("sidePanel")!.offsetWidth - 40;
    if (pt.x > limit) map.panBy([pt.x - limit + 40, 0], { duration: 400 });
  } else if (pt.y > H * 0.18) map.panBy([0, pt.y - H * 0.12], { duration: 400 });
}

/** Hover y clic sobre píldoras y puntos. El hover se calcula una vez por cuadro, no en cada evento del mouse. */
export function usePointInteractions(map: MLMap | null, engine: OverlayEngine | null, ready: boolean) {
  useEffect(() => {
    if (!map || !engine || !ready) return;
    const canvas = map.getCanvas();
    const st = useStore.getState;
    const query = (pt: MapMouseEvent["point"]) => {
      if (st().view === 1 || !st().ptsOn || !map.getLayer("pts")) return [];
      return map.queryRenderedFeatures(pt, { layers: ["pts-feat", "pts"] });
    };
    let raf = 0, last: MapMouseEvent | null = null;
    const handle = () => {
      raf = 0;
      const e = last;
      if (!e) return;
      // 1) Píldoras: tienen prioridad sobre los puntos que cubren
      const c = engine.hitCard(e.point);
      engine.setHover(c ? c.key : null);
      if (c) { st().setHoverPoint(-1); canvas.style.cursor = "pointer"; return; }
      // 2) Puntos (solo vistas 2 y 3)
      const f = query(e.point);
      if (!f.length) { st().setHoverPoint(-1); canvas.style.cursor = ""; return; }
      canvas.style.cursor = "pointer";
      st().setHoverPoint(f[0].properties.i as number);
    };
    const onMove = (e: MapMouseEvent) => { last = e; if (!raf) raf = requestAnimationFrame(handle); };
    const onLeave = () => { last = null; engine.setHover(null); st().setHoverPoint(-1); canvas.style.cursor = ""; };
    const onMoveStart = () => st().setHoverPoint(-1);
    const onClick = (e: MapMouseEvent) => {
      const c = engine.hitCard(e.point);
      if (c) { engine.setHover(null); engine.zoomToGroup(c); return; }
      const f = query(e.point);
      if (f.length) selectPoint(map, f[0].properties.i as number);
    };
    map.on("mousemove", onMove); map.on("movestart", onMoveStart); map.on("click", onClick);
    canvas.addEventListener("mouseleave", onLeave);
    return () => {
      map.off("mousemove", onMove); map.off("movestart", onMoveStart); map.off("click", onClick);
      canvas.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [map, engine, ready]);
}
