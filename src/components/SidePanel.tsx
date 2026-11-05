import { useEffect, useMemo, useState, type MouseEvent as RMouseEvent, type ReactNode } from "react";
import { fmtEnergy, fmtKw, fmtMoney, keyLabel, nf1, nf2, nfInt } from "../lib/format";
import { histOf } from "../lib/selectors";
import { useStore } from "../store";
import { useVisible } from "../lib/useVisible";
import { Chart } from "./Chart";
import { FeatChips, SrcMark, endLabel, histStats, ventana12 } from "./common";

function Box(p: { lab: string; v: number; f: (v: number) => string; unit: string; na: string; mark?: ReactNode; n: number }) {
  return (
    <div className="sbox">
      <div className="lab">{p.lab}{p.mark}</div>
      {isFinite(p.v)
        ? <><div className="num">{p.f(p.v)}<small>{p.unit}</small></div>{p.n < 12 && <div className="flag">{p.n} de 12 meses con dato</div>}</>
        : <div className="num na">{p.na}</div>}
    </div>
  );
}

export function SidePanel() {
  const model = useStore((s) => s.model);
  const selected = useStore((s) => s.selected);
  const month = useStore((s) => s.month);
  const vis = useVisible();
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const open = selected >= 0 && !!model;

  // La hoja de estilos usa la clase del body para abrir el panel y apartar el panel inferior
  useEffect(() => { document.body.classList.toggle("panel-open", open); }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && useStore.getState().selected >= 0) useStore.getState().select(-1); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // Si un filtro deja fuera al inmueble seleccionado, el panel se cierra
  useEffect(() => { if (vis && selected >= 0 && !vis.passes(selected)) useStore.getState().select(-1); }, [vis, selected]);

  const p = model && selected >= 0 ? model.props[selected] : null;
  const hist = useMemo(() => (model && p ? histOf(model, p.i) : []), [model, p]);

  let head: ReactNode = null, body: ReactNode = null;
  if (model && p) {
    const zone = model.zones.find((z) => z.id === p.zone);
    const sub = p.sub >= 0 ? model.subs[p.sub] : undefined;
    const st = histStats(hist), v12 = ventana12(hist), s12 = histStats(v12.h);
    const sinDemanda = p.demandaAplica === false;
    const det: [string, string][] = [
      ["Dependencia", p.dependencia], ["Zona", (zone ? zone.nombre : "—") + (sub && !sub.single ? " · " + sub.nombre : "")],
      ...(p.region ? [[p.regionTipo, p.region] as [string, string]] : []), ["Municipio", p.municipio || "—"], ["RPU", p.rpu || "—"], ["Nodo", p.nodo ? String(p.nodo) : "N/A"],
      ["Fin del último recibo", endLabel(p, model)],
      ["Meses en la línea de tiempo", `${model.months.filter((_, k) => isFinite(model.kwh[p.i * model.M + k]) || isFinite(model.imp[p.i * model.M + k])).length} de ${model.M}`]
    ];
    // Historial completo, mes a mes (los meses sin dato completo quedan como hueco)
    const keys: string[] = [];
    if (st.n) {
      let [y, m] = st.desde!.split("-").map(Number);
      while (`${y}-${String(m).padStart(2, "0")}` <= st.hasta!) { keys.push(`${y}-${String(m).padStart(2, "0")}`); if (m === 12) { y++; m = 1; } else m++; }
    }
    const byKey = new Map(hist.map((r) => [r.key, r]));
    const serie = (f: (r: (typeof hist)[number]) => number) => keys.map((k) => { const r = byKey.get(k); return r ? f(r) : NaN; });
    const fuente = p.prSrc === "impreso" ? "precio medio impreso en el historial" : p.prSrc === "importe" ? "importe ÷ kWh" : "";
    const selKey = model.months[month].key;
    const tIndex = new Map(model.months.map((m, k) => [m.key, k]));
    const prom = (todo: number, doce: number, n12: number) => ({ todo, doce, n12, ini: v12.ini });
    const common = { keys, selKey, tIndex };

    head = (
      <>
        <h2>{p.nombre}</h2>
        <div className="addr">{p.direccion}</div>
        <div className="chips">
          {p.tarifa && <span className="chip">Tarifa {p.tarifa}</span>}
          <FeatChips p={p} />
          {p.valid === true && <span className="chip ok">Ubicación validada</span>}
          {p.valid === false && <span className="chip bad">Ubicación sin validar</span>}
        </div>
      </>
    );
    body = (
      <>
        <dl className="details">{det.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <div className="summary">
          <Box lab="Consumo promedio" v={s12.kwh} f={(v) => nfInt.format(v)} unit="kWh/mes" na="Sin dato" n={s12.nk} />
          <Box lab="Demanda promedio" v={sinDemanda ? NaN : s12.kw} f={(v) => (v < 100 ? nf1 : nfInt).format(v)} unit="kW" na={sinDemanda ? "N/A" : "Sin dato"} n={s12.nw} />
          <Box lab="Importe promedio" v={s12.imp} f={(v) => "$" + nfInt.format(v)} unit="MXN/mes" na={p.prSrc === "impreso" ? "No impreso" : "Sin dato"} n={s12.ni} />
          <Box lab="Precio promedio" v={s12.pr} f={(v) => "$" + nf2.format(v)} unit="por kWh" na="Sin dato" mark={<SrcMark src={p.prSrc} />} n={s12.np} />
        </div>
        <div className="basis">
          {st.n
            ? <>Promedios de los últimos 12 meses ({keyLabel(v12.ini!)} – {keyLabel(v12.fin!)}) · historial completo: {st.n} meses desde {keyLabel(st.desde!)}{fuente && <> · <SrcMark src={p.prSrc} /> {fuente}</>}</>
            : "Sin historial registrado"}
        </div>
        <Chart {...common} title="Consumo" unit="kWh" vals={serie((r) => r.kwh)} color="#a9b6ee" fmt={fmtEnergy} emptyText="Sin historial registrado" prom={prom(st.kwh, s12.kwh, s12.nk)} />
        <Chart {...common} title="Demanda" unit="kW" vals={serie((r) => r.kw)} color="#f0b3c4" fmt={fmtKw}
          emptyText={!st.n ? "Sin historial registrado" : sinDemanda ? "N/A: la tarifa de este inmueble no registra demanda" : "Sin registros de demanda"} prom={prom(st.kw, s12.kw, s12.nw)} />
        <Chart {...common} title="Importe" unit="MXN" vals={serie((r) => r.imp)} color="#9fd5bb" fmt={fmtMoney}
          emptyText={!st.n ? "Sin historial registrado" : p.prSrc === "impreso" ? "El historial de esta tarifa no imprime importe; el precio es el precio medio impreso" : "Sin importes facturados"} prom={prom(st.imp, s12.imp, s12.ni)} />
        <Chart {...common} title={<>Precio por kWh<SrcMark src={p.prSrc} /></>} unit="MXN/kWh" vals={serie((r) => r.pr)} color="#f3cf96" fmt={(v) => "$" + nf2.format(v)}
          emptyText={st.n ? "Sin datos para el precio" : "Sin historial registrado"} prom={prom(st.pr, s12.pr, s12.np)} />
      </>
    );
  }

  const onMove = (e: RMouseEvent) => {
    const b = (e.target as Element).closest?.(".bar") as SVGElement | null;
    setTip(b ? { text: b.dataset.tip ?? "", x: e.clientX, y: e.clientY } : null);
  };
  const onClick = (e: RMouseEvent) => {
    const b = (e.target as Element).closest?.(".bar") as SVGElement | null;
    if (b && b.dataset.k) useStore.getState().setMonth(+b.dataset.k);
  };

  return (
    <>
      <aside id="sidePanel" aria-label="Detalle del inmueble">
        <div className="sp-head" id="spHead">{head}</div>
        <button id="spClose" type="button" aria-label="Cerrar" onClick={() => useStore.getState().select(-1)}>×</button>
        <div className="sp-body" id="spBody" onMouseMove={onMove} onMouseLeave={() => setTip(null)} onClick={onClick}>{body}</div>
      </aside>
      {tip && <div id="chartTip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
    </>
  );
}
