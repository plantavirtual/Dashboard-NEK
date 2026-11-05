import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_MODES, MEASURES, MES_CORTO, MES_LARGO, VIEW_LABELS } from "../lib/constants";
import { fmtCorte, fmtMeasure, nfInt } from "../lib/format";
import { isCatMode, matrixOf, measureOf } from "../lib/selectors";
import { useStore } from "../store";
import { useVisible } from "../lib/useVisible";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(260);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(el.clientWidth || 260);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Legend() {
  const colorBy = useStore((s) => s.colorBy);
  const view = useStore((s) => s.view);
  const v = useVisible();
  const [rampRef, rampW] = useWidth<HTMLDivElement>();
  const model = v?.model;
  const cat = isCatMode(colorBy);
  const measure = measureOf(colorBy);

  const entries = useMemo(() => {
    if (!v || !cat) return [];
    const { model: m, visible } = v;
    const counts = new Int32Array(m.cats[colorBy].labels.length);
    for (const i of visible) { const c = m.catIdx[colorBy][i]; if (c >= 0) counts[c]++; }
    return m.cats[colorBy].labels.map((l, k) => ({ l, c: m.cats[colorBy].colors[k], n: counts[k] })).filter((e) => e.n > 0);
  }, [v, cat, colorBy]);

  const sc = model?.scales[measure];
  const meas = MEASURES[measure];
  const f = (x: number) => fmtMeasure(measure, x);
  const nb = sc ? sc.colors.length : 0, b = sc?.breaks ?? [];
  const cabe = rampW / Math.max(nb, 1) >= 27;   // un corte entre cada par de clases; si no caben, uno sí y uno no

  return (
    <div id="legend">
      <div className="lg-head">
        <div className="lg-title" id="lgTitle">{cat ? CATEGORY_MODES[colorBy].title : <>{meas.title}<span>{meas.unit}</span></>}</div>
        <div className="lg-note" id="lgNote"
          title={!cat && sc && b.length ? `Percentil 2: ${f(sc.p2)} · mediana: ${f(sc.median)} · percentil 98: ${f(sc.p98)}. Lo que queda fuera toma el color de la clase extrema.` : undefined}>
          {cat ? "inmuebles" : b.length ? `log ${sc!.serie} · percentiles 2–98` : ""}
        </div>
      </div>
      <div id="numLegend" hidden={cat}>
        <div className="ramp" id="ramp" ref={rampRef}>
          {sc?.colors.map((c, i) => {
            const t = !b.length ? "" : i === 0 ? `menos de ${f(b[0])}` : i === nb - 1 ? `${f(b[nb - 2])} o más` : `${f(b[i - 1])} – ${f(b[i])}`;
            return <i key={i} style={{ background: c }} title={t} />;
          })}
        </div>
        <div className="ramp-ticks" id="rampTicks">
          {b.map((x, i) => (cabe || i % 2 === 0) ? <span key={i} style={{ left: `${((i + 1) / nb) * 100}%` }}>{fmtCorte(measure, x)}</span> : null)}
        </div>
      </div>
      <div className="cats" id="catLegend" hidden={!cat}>
        {entries.map((e) => (
          <div key={e.l} title={e.l}><i className="kdot" style={{ background: e.c }} /><span className="lab">{e.l}</span><b>{nfInt.format(e.n)}</b></div>
        ))}
      </div>
      <div className="keys" id="lgKeys" hidden={cat}>
        <span><i className="kdot" style={{ background: "#c3c5cf" }} />0 o sin dato en el mes</span>
        <span><i className="kdot" style={{ background: "#fff", boxShadow: "inset 0 0 0 1.3px #a7aab8" }} />Sin historial</span>
      </div>
      <div className="lg-src" id="lgSrc" hidden={cat || measure !== "precio"}>¹ precio medio impreso · ² importe ÷ kWh</div>
      <div className="viewind">
        <span className="bars" id="viewBars">{[0, 1, 2].map((k) => <i key={k} className={k < view ? "on" : undefined} />)}</span>
        <span id="viewLabel">{VIEW_LABELS[view - 1]}</span>
      </div>
    </div>
  );
}

const PLAY = <svg width="12" height="13" viewBox="0 0 12 13"><path d="M2 1.2v10.6L11 6.5z" fill="currentColor" /></svg>;
const PAUSE = <svg width="12" height="13" viewBox="0 0 12 13"><rect x="1.5" y="1" width="3.2" height="11" rx="1" fill="currentColor" /><rect x="7.3" y="1" width="3.2" height="11" rx="1" fill="currentColor" /></svg>;

function Timeline() {
  const month = useStore((s) => s.month);
  const colorBy = useStore((s) => s.colorBy);
  const playing = useStore((s) => s.playing);
  const v = useVisible();
  const model = v?.model;
  const M = model?.M ?? 0;
  const measure = measureOf(colorBy);

  // Reproducción: avanza un mes cada 1.2 s y se detiene en el último
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const s = useStore.getState();
      if (s.month >= M - 1) { s.setPlaying(false); return; }
      s.setMonth(s.month + 1);
    }, 1200);
    return () => clearInterval(id);
  }, [playing, M]);

  const cov = useMemo(() => {
    if (!v) return [] as number[];
    const mat = matrixOf(v.model, measure), n = v.visible.length;
    return Array.from({ length: v.model.M }, (_, k) => {
      if (!n) return 0;
      let c = 0;
      for (const i of v.visible) if (isFinite(mat[i * v.model.M + k])) c++;
      return c / n;
    });
  }, [v, measure]);

  if (!model || !v) return (
    <div id="timeline"><div className="tl-head"><button id="playBtn" type="button" aria-label="Reproducir meses" disabled>{PLAY}</button></div><div id="months" /></div>
  );
  const m = model.months[month];
  const withData = Math.round((cov[month] ?? 0) * v.visible.length);
  const toggle = () => {
    const s = useStore.getState();
    if (s.playing) { s.setPlaying(false); return; }
    if (s.month >= M - 1) s.setMonth(0);
    s.setPlaying(true);
  };
  return (
    <div id="timeline">
      <div className="tl-head">
        <button id="playBtn" type="button" aria-label={playing ? "Pausar" : "Reproducir meses"} onClick={toggle}>{playing ? PAUSE : PLAY}</button>
        <div>
          <div id="monthTitle">{MES_LARGO[m.m]} {m.y}</div>
          <div id="monthSub">{nfInt.format(withData)} de {nfInt.format(v.visible.length)} inmuebles con registro</div>
        </div>
      </div>
      <div id="months" role="group" aria-label="Mes" style={{ gridTemplateColumns: `repeat(${Math.max(M, 6)}, minmax(0, 1fr))` }}>
        {model.months.map((mm, k) => (
          <button key={mm.key} type="button" className="mbtn" aria-pressed={k === month}
            title={`${MES_LARGO[mm.m]} ${mm.y}: ${Math.round((cov[k] ?? 0) * 100)}% con registro`}
            onClick={() => { useStore.getState().setPlaying(false); useStore.getState().setMonth(k); }}>
            {MES_CORTO[mm.m]}<small>{mm.y}</small>
            <span className="cov"><i style={{ width: ((cov[k] ?? 0) * 100).toFixed(1) + "%" }} /></span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function BottomPanel() {
  return (
    <section id="bottomPanel" aria-label="Escala y meses">
      <Legend />
      <div className="divider" />
      <Timeline />
    </section>
  );
}
