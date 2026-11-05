import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { CTX_LABELS } from "../lib/constants";
import { fmtEnergy, fmtKw, fmtPrice, nfInt } from "../lib/format";
import { aggregate, isCatMode, makePasses, measureOf, type Agg } from "../lib/selectors";
import { useStore } from "../store";
import { OverlayEngine } from "../map/overlayEngine";
import type { ColorBy } from "../data/types";

function cardText(a: Agg | undefined, colorBy: ColorBy, nombre: string) {
  if (!a) return { val: "", title: nombre };
  let val = fmtEnergy(a.total);
  if (isCatMode(colorBy)) { if (a.top) val += ` · ${Math.round((a.topShare ?? 0) * 100)}% ${a.top}`; }
  else if (measureOf(colorBy) === "precio") val += " · " + fmtPrice(a.avg.precio);
  else if (measureOf(colorBy) === "demanda") val += " · mediana " + fmtKw(a.avg.demanda);
  // "312 de 340 inmuebles" si a algunos les falta el mes, "340 inmuebles" si no
  val = (a.nk < a.count ? `${nfInt.format(a.nk)} de ${nfInt.format(a.count)}` : nfInt.format(a.count)) + " inmuebles · " + val;
  return { val, title: `${nombre} — ${nfInt.format(a.count)} inmuebles; ${nfInt.format(a.nk)} con consumo en el mes forman el total` };
}

/* className y hidden son constantes a propósito: React no los vuelve a tocar y el motor los maneja a mano
   (modos m-dot/m-name/m-full, hot, expanded, hidden). */
const Pill = memo(function Pill(p: {
  k: string; kind: "zone" | "sub"; nombre: string; agg?: Agg; colorBy: ColorBy; reg: (k: string, el: HTMLDivElement | null) => void;
}) {
  const t = cardText(p.agg, p.colorBy, p.nombre);
  return (
    <div className={"card " + p.kind} hidden title={t.title} ref={(el) => p.reg(p.k, el)}>
      <span className="dot" style={{ background: p.agg?.color }} />
      <span className="txt"><span className="nm">{p.nombre}</span><span className="val">{t.val}</span></span>
    </div>
  );
});

export function Overlay({ map, fitZoom, onEngine }: { map: MLMap; fitZoom: number; onEngine: (e: OverlayEngine | null) => void }) {
  const model = useStore((s) => s.model);
  const month = useStore((s) => s.month);
  const colorBy = useStore((s) => s.colorBy);
  const dep = useStore((s) => s.dep);
  const fin = useStore((s) => s.fin);
  const leadersRef = useRef<SVGSVGElement>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const els = useRef(new Map<string, HTMLDivElement>());
  const engineRef = useRef<OverlayEngine | null>(null);

  // Motor: se crea una vez por mapa
  useEffect(() => {
    const e = new OverlayEngine(map, leadersRef.current!, labelRefs.current as HTMLElement[], fitZoom,
      (k) => useStore.getState().setHoverKey(k), () => useStore.getState().model);
    engineRef.current = e;
    onEngine(e);
    const q = () => e.queue(), rm = () => e.remeasure();
    map.on("move", q); map.on("resize", rm);
    const bp = document.getElementById("bottomPanel"), sp = document.getElementById("sidePanel");
    const ro = new ResizeObserver(q);
    if (bp) ro.observe(bp);
    sp?.addEventListener("transitionend", q);
    document.fonts?.ready.then(rm);
    q();
    return () => { map.off("move", q); map.off("resize", rm); ro.disconnect(); sp?.removeEventListener("transitionend", q); e.destroy(); engineRef.current = null; onEngine(null); };
  }, [map, fitZoom, onEngine]);

  const reg = useMemo(() => (k: string, el: HTMLDivElement | null) => { if (el) els.current.set(k, el); else els.current.delete(k); }, []);

  const aggs = useMemo(() => {
    const out = new Map<string, Agg>();
    if (!model) return out;
    const passes = makePasses(model, { dep, fin });
    for (const z of model.zones) out.set("z" + z.id, aggregate(model, z.members, month, colorBy, passes));
    for (const s of model.subs) if (!s.single) out.set("s" + s.id, aggregate(model, s.members, month, colorBy, passes));
    return out;
  }, [model, month, colorBy, dep, fin]);

  // Después de que React pinta el contenido nuevo de las píldoras, el motor las registra, mide y coloca
  useLayoutEffect(() => {
    const e = engineRef.current;
    if (!e || !model) return;
    const keys = new Set<string>();
    for (const z of model.zones) { keys.add("z" + z.id); e.register("z" + z.id, "zone", z, els.current.get("z" + z.id) ?? null); }
    for (const s of model.subs) if (!s.single) { keys.add("s" + s.id); e.register("s" + s.id, "sub", s, els.current.get("s" + s.id) ?? null); }
    for (const k of [...e.cards.keys()]) if (!keys.has(k)) e.cards.delete(k);
    e.setAggs(aggs);
  }, [model, aggs]);

  const hoverKey = useStore((s) => s.hoverKey);
  useEffect(() => { engineRef.current?.queue(); }, [hoverKey]);

  return (
    <>
      <svg id="leaders" ref={leadersRef} />
      <div id="overlay">
        {CTX_LABELS.map((l, k) => (
          <div key={l.t} className={"ctx " + l.cls} ref={(el) => { labelRefs.current[k] = el; }}>{l.t}</div>
        ))}
        {model?.zones.map((z) => <Pill key={"z" + z.id} k={"z" + z.id} kind="zone" nombre={z.nombre} agg={aggs.get("z" + z.id)} colorBy={colorBy} reg={reg} />)}
        {model?.subs.filter((s) => !s.single).map((s) => <Pill key={"s" + s.id} k={"s" + s.id} kind="sub" nombre={s.nombre} agg={aggs.get("s" + s.id)} colorBy={colorBy} reg={reg} />)}
      </div>
    </>
  );
}
