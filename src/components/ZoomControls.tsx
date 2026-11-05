import type { Map as MLMap } from "maplibre-gl";

export function ZoomControls({ map }: { map: MLMap | null }) {
  return (
    <div id="zoomCtl">
      <button id="zin" type="button" aria-label="Acercar" onClick={() => map?.zoomIn()}>+</button>
      <button id="zout" type="button" aria-label="Alejar" onClick={() => map?.zoomOut()}>−</button>
    </div>
  );
}
