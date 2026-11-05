import { useLayoutEffect, useMemo, useRef } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { CATEGORY_MODES, MEASURES, MES_CORTO, NODATA } from "../lib/constants";
import { fmtEnergy, fmtKw, fmtMeasure, fmtPrice, keyLabel } from "../lib/format";
import { histOf, isCatMode, matrixOf, measureOf } from "../lib/selectors";
import { catLabel } from "../lib/categories";
import { useStore } from "../store";
import { FeatChips, SrcMark, colorForValue, histStats, ventana12 } from "./common";

/** Tarjeta al pasar sobre un punto */
export function HoverCard({ map }: { map: MLMap | null }) {
  const model = useStore((s) => s.model);
  const i = useStore((s) => s.hoverPoint);
  const month = useStore((s) => s.month);
  const colorBy = useStore((s) => s.colorBy);
  const ref = useRef<HTMLDivElement>(null);
  const p = model && i >= 0 ? model.props[i] : null;
  const hist = useMemo(() => (model && p ? histOf(model, p.i) : []), [model, p]);

  // Posición: se calcula al mostrarla (el mapa la oculta en cuanto empieza a moverse)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !map || !p) return;
    const W = map.getContainer().clientWidth;
    const pt = map.project([p.lon, p.lat]);
    const w = el.offsetWidth, h = el.offsetHeight;
    const x = Math.max(10, Math.min(W - w - 10, pt.x - w / 2));
    let y = pt.y - h - 16;
    if (y < 10) y = pt.y + 16;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }, [map, p, month, colorBy]);

  if (!model || !p) return <div id="hoverCard" hidden />;
  const cat = isCatMode(colorBy);
  const measure = measureOf(colorBy);
  const m = model.months[month];
  const v = matrixOf(model, measure)[p.i * model.M + month];
  const v12 = ventana12(hist), st = histStats(v12.h);
  const catColor = cat ? model.cats[colorBy].colors[model.catIdx[colorBy][p.i]] ?? NODATA : NODATA;
  const prom = (
    <small>Últimos 12 meses{st.n < 12 ? ` (${st.n} con dato)` : ""}{st.n ? ` · ${keyLabel(v12.ini!)} – ${keyLabel(v12.fin!)}` : ""}</small>
  );

  return (
    <div id="hoverCard" ref={ref}>
      <h3>{p.nombre}</h3>
      <div className="addr">{p.direccion}</div>
      <dl className="kv">
        {p.region && <><dt>{p.regionTipo}</dt><dd>{p.region}</dd></>}
        <dt>RPU</dt><dd>{p.rpu || "—"}</dd>
        <dt>Nodo</dt><dd>{p.nodo ? String(p.nodo) : "N/A"}</dd>
        {(p.feature || p.bidir) && <><dt>Características</dt><dd className="feats"><FeatChips p={p} /></dd></>}
      </dl>
      {isCatMode(colorBy) && (
        <div className="hc-row"><span className="dot" style={{ background: catColor }} />
          <span>{CATEGORY_MODES[colorBy].title}: <b>{catLabel(p, colorBy)}</b></span></div>
      )}
      {p.hasHist ? (
        <>
          <div className="hc-row" style={cat ? { marginTop: 6 } : undefined}>
            <span className="dot" style={cat ? { background: "transparent", boxShadow: "inset 0 0 0 1.3px #c3c5cf" } : { background: colorForValue(model, measure, v) }} />
            <span>{MEASURES[measure].title} en {MES_CORTO[m.m]} {m.y}:{" "}
              <b>{measure === "demanda" && p.demandaAplica === false ? "N/A"
                : isFinite(v) ? <>{fmtMeasure(measure, v)}{measure === "precio" && <SrcMark src={p.prSrc} />}</> : "sin dato"}</b></span>
          </div>
          <div className="hc-avg">Promedio: <b>{fmtEnergy(st.kwh)}</b>/mes
            {p.demandaAplica === false ? " · demanda N/A" : isFinite(st.kw) ? <> · <b>{fmtKw(st.kw)}</b></> : null}
            {isFinite(st.pr) && <> · <b>{fmtPrice(st.pr)}</b><SrcMark src={p.prSrc} /></>}
            {prom}</div>
        </>
      ) : (
        <>
          <div className="hc-row"><span className="dot" style={{ background: "#fff", boxShadow: "inset 0 0 0 1.3px #a7aab8" }} />Sin historial en la línea de tiempo</div>
          {st.n > 0 && <div className="hc-avg">Promedio: <b>{fmtEnergy(st.kwh)}</b>/mes{prom}</div>}
        </>
      )}
    </div>
  );
}
