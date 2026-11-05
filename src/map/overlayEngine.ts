import type { Map as MLMap } from "maplibre-gl";
import { CTX_LABELS, VIEW2, VIEW3 } from "../lib/constants";
import { makePasses, type Agg } from "../lib/selectors";
import { useStore } from "../store";
import type { Model, SubInfo, ZoneInfo } from "../data/types";

interface Rect { x0: number; y0: number; x1: number; y1: number; forced?: boolean }
export interface Card {
  key: string; kind: "zone" | "sub"; ref: ZoneInfo | SubInfo; el: HTMLElement;
  sizes: Record<string, [number, number]>; mode: string; rect: Rect | null;
  off: [number, number] | null; offMode?: string; agg?: Agg;
}

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

const CANDIDATES: [number, number][] = (() => {
  const out: [number, number][] = [[0, 0]];
  for (let r = 1; r <= 7; r++) {
    const steps = 8 + r * 4;
    for (let k = 0; k < steps; k++) { const a = (k / steps) * Math.PI * 2 - Math.PI / 2; out.push([Math.cos(a) * r * 20, Math.sin(a) * r * 15]); }
  }
  return out;
})();

export function fitPadding() {
  const wrap = document.getElementById("mapWrap")!.getBoundingClientRect(), bp = document.getElementById("bottomPanel")!.getBoundingClientRect();
  const bottom = Math.max(24, wrap.bottom - bp.top + 16);
  const side = wrap.width < 600 ? 14 : 40;
  return { top: 22, bottom: Math.min(bottom, wrap.height * 0.6), left: side, right: side + 30 };
}

/** Motor imperativo de las píldoras: colocar cientos de etiquetas sin que se encimen en cada cuadro del mapa
    no se puede pasar por el render de React. React pinta el contenido; este motor solo mueve los elementos. */
export class OverlayEngine {
  cards = new Map<string, Card>();
  private queued = false;
  private hoverKey: string | null = null;
  private stageName: number; private stageFull: number; private fitZoom: number;
  private dead = false;

  constructor(
    private map: MLMap, private leadersEl: SVGElement, private labelEls: HTMLElement[], fitZoom: number,
    private onHover: (key: string | null) => void, private getModel: () => Model | null
  ) {
    this.fitZoom = fitZoom;
    this.stageName = fitZoom - 0.3;
    this.stageFull = Math.min(VIEW2 - 0.3, fitZoom + 0.7);
  }
  destroy() { this.dead = true; }

  register(key: string, kind: "zone" | "sub", ref: ZoneInfo | SubInfo, el: HTMLElement | null) {
    if (!el) { this.cards.delete(key); return; }
    const old = this.cards.get(key);
    if (old && old.el === el) { old.ref = ref; return; }
    this.cards.set(key, { key, kind, ref, el, sizes: {}, mode: "", rect: null, off: null });
  }
  setAggs(aggs: Map<string, Agg>) {
    for (const c of this.cards.values()) { c.agg = aggs.get(c.key); c.sizes = {}; }
    this.queue();
  }
  remeasure() { for (const c of this.cards.values()) c.sizes = {}; this.queue(); }
  queue() {
    if (this.queued || this.dead) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; if (!this.dead) this.render(); });
  }

  private sizeOf(c: Card, mode: string): [number, number] {
    if (!c.sizes[mode]) {
      c.el.hidden = false;
      this.setMode(c, mode);
      c.sizes[mode] = [c.el.offsetWidth, c.el.offsetHeight];
    }
    return c.sizes[mode];
  }
  private setMode(c: Card, mode: string) {
    if (c.mode !== mode) { c.el.classList.remove("m-dot", "m-name", "m-full"); c.el.classList.add("m-" + mode); c.mode = mode; }
  }
  private reservedRects(): Rect[] {
    const wrap = document.getElementById("mapWrap")!.getBoundingClientRect();
    const rel = (r: DOMRect, pad = 8): Rect => ({ x0: r.left - wrap.left - pad, y0: r.top - wrap.top - pad, x1: r.right - wrap.left + pad, y1: r.bottom - wrap.top + pad });
    const out = [rel(document.getElementById("zoomCtl")!.getBoundingClientRect()), rel(document.getElementById("bottomPanel")!.getBoundingClientRect())];
    if (document.body.classList.contains("panel-open")) out.push(rel(document.getElementById("sidePanel")!.getBoundingClientRect()));
    return out;
  }
  private place(ax: number, ay: number, w: number, h: number, placed: Rect[], W: number, H: number, allowOverlap: boolean, prevOff: [number, number] | null): Rect | null {
    // posición natural: centrada sobre el punto ancla; luego la posición anterior; luego anillos alrededor
    const baseX = ax - w / 2, baseY = ay - h - 7;
    let best: Rect | null = null, bestCost = Infinity;
    const tryAt = (x: number, y: number) => {
      const r: Rect = { x0: x, y0: y, x1: x + w, y1: y + h };
      if (r.x0 < 6 || r.y0 < 6 || r.x1 > W - 6 || r.y1 > H - 6) return null;
      let cost = 0;
      const grown: Rect = { x0: r.x0 - 3, y0: r.y0 - 3, x1: r.x1 + 3, y1: r.y1 + 3 };
      for (const q of placed) { const o = overlapArea(grown, q); if (o) cost += o; }
      return { r, cost };
    };
    const order = prevOff ? [CANDIDATES[0], prevOff, ...CANDIDATES.slice(1)] : CANDIDATES;
    for (const [dx, dy] of order) {
      const t = tryAt(baseX + dx, baseY + dy);
      if (!t) continue;
      if (t.cost === 0) return t.r;
      if (t.cost < bestCost) { bestCost = t.cost; best = t.r; }
    }
    if (!allowOverlap) return null;
    return best || { x0: Math.max(6, Math.min(W - 6 - w, baseX)), y0: Math.max(6, Math.min(H - 6 - h, baseY)), x1: 0, y1: 0, forced: true };
  }

  render() {
    const map = this.map;
    const z = map.getZoom();
    const W = map.getContainer().clientWidth, H = map.getContainer().clientHeight;

    CTX_LABELS.forEach((l, k) => {
      const el = this.labelEls[k];
      if (!el) return;
      const p = map.project([l.lon, l.lat]);
      el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${l.rot || 0}deg) translate(-50%, -50%)`;
      el.classList.toggle("off", z > this.fitZoom + 0.9);
    });

    const reserved = this.reservedRects();
    const placed = reserved.slice();
    const lines: string[] = [];
    const show = new Set<Card>();
    const view = useStore.getState().view;
    // El punto ancla debe verse: dentro del mapa y no debajo de los paneles
    const visibleAnchor = (a: { x: number; y: number }) => a.x >= 4 && a.y >= 4 && a.x <= W - 4 && a.y <= H - 4 &&
      !reserved.some((q) => a.x > q.x0 && a.x < q.x1 && a.y > q.y0 && a.y < q.y1);
    const commit = (c: Card, a: { x: number; y: number }, r: Rect, w: number, h: number, m: string) => {
      this.setMode(c, m);
      if (!r.x1) { r.x1 = r.x0 + w; r.y1 = r.y0 + h; }
      c.off = [r.x0 - (a.x - w / 2), r.y0 - (a.y - h - 7)];
      c.offMode = m;
      c.rect = r;
      placed.push(r);
      show.add(c);
      c.el.style.transform = `translate(${Math.round(r.x0)}px, ${Math.round(r.y0)}px)`;
      lines.push(this.leader(a, r, w, h));
    };
    const prev = (c: Card, m: string) => (c.off && c.offMode === m ? c.off : null);

    if (view === 1) {
      const mode = z < this.stageName ? "dot" : z < this.stageFull ? "name" : "full";
      const zs = [...this.cards.values()].filter((c) => c.kind === "zone" && c.agg && c.agg.count > 0).sort((a, b) => b.agg!.count - a.agg!.count);
      for (const c of zs) {
        const a = map.project([c.ref.lon, c.ref.lat]);
        if (!visibleAnchor(a)) continue;   // si la cabecera de la zona no está a la vista, la píldora se oculta
        let m = mode, [w, h] = this.sizeOf(c, m);
        let r = this.place(a.x, a.y, w, h, placed, W, H, m === "dot", prev(c, m));
        if (!r && m === "full") { m = "name"; [w, h] = this.sizeOf(c, m); r = this.place(a.x, a.y, w, h, placed, W, H, false, prev(c, m)); }
        if (!r) { m = "dot"; [w, h] = this.sizeOf(c, m); r = this.place(a.x, a.y, w, h, placed, W, H, true, prev(c, m)); }
        if (r) commit(c, a, r, w, h, m);
      }
    } else if (view === 2) {
      const subs = [...this.cards.values()].filter((c) => c.kind === "sub" && c.agg && c.agg.count > 0)
        .map((c) => ({ c, a: map.project([c.ref.lon, c.ref.lat]) }))
        .filter(({ a }) => visibleAnchor(a))
        .sort((x, y) => y.c.agg!.count - x.c.agg!.count);
      for (const { c, a } of subs) {
        const [w, h] = this.sizeOf(c, "full");
        const r = this.place(a.x, a.y, w, h, placed, W, H, false, prev(c, "full"));
        if (r) commit(c, a, r, w, h, "full");
      }
    }
    for (const c of this.cards.values()) {
      const on = show.has(c);
      c.el.hidden = !on;
      if (!on) { c.rect = null; c.off = null; }
      c.el.classList.toggle("expanded", on && c.key === this.hoverKey && c.mode !== "full");
    }
    // Si la píldora con hover desapareció (colisión, cambio de vista), se quita el resaltado
    const hc = this.hoverKey ? this.cards.get(this.hoverKey) : null;
    if (this.hoverKey && (!hc || !show.has(hc))) this.setHover(null);
    this.leadersEl.innerHTML = lines.join("");
  }

  private leader(a: { x: number; y: number }, r: Rect, w: number, h: number): string {
    const cx = r.x0 + w / 2, cy = r.y0 + h / 2;
    const nx = Math.max(r.x0 + 10, Math.min(r.x1 - 10, a.x)), ny = a.y < r.y0 ? r.y0 : a.y > r.y1 ? r.y1 : cy;
    const natural = Math.abs(cx - a.x) < 4 && Math.abs(r.y1 + 7 - a.y) < 4;
    const dot = `<circle class="anchor" cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="2.6"/>`;
    if (natural) return dot;
    return `<path class="leader" d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${nx.toFixed(1)} ${ny.toFixed(1)}"/>` + dot;
  }

  setHover(key: string | null) {
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    for (const c of this.cards.values()) {
      const hot = c.key === key;
      c.el.classList.toggle("hot", hot);
      c.el.classList.toggle("expanded", hot && c.mode !== "full");
    }
    this.onHover(key);
  }
  /** Qué píldora está bajo un punto de la pantalla (la que tiene hover primero, porque está encima y crece) */
  hitCard(pt: { x: number; y: number }): Card | null {
    const inside = (r: Rect | null) => !!r && pt.x >= r.x0 && pt.x <= r.x1 && pt.y >= r.y0 && pt.y <= r.y1;
    if (this.hoverKey) {
      const c = this.cards.get(this.hoverKey);
      if (c && c.rect && !c.el.hidden) {
        const wrap = document.getElementById("mapWrap")!.getBoundingClientRect(), b = c.el.getBoundingClientRect();
        if (inside({ x0: b.left - wrap.left, y0: b.top - wrap.top, x1: b.right - wrap.left, y1: b.bottom - wrap.top })) return c;
      }
    }
    for (const c of this.cards.values()) if (!c.el.hidden && inside(c.rect)) return c;
    return null;
  }

  /** Nivel 2 → 3: en lugar de todo el subgrupo, el vecindario más denso (con sus k vecinos más cercanos).
      Las ubicaciones repetidas (varios RPU en un mismo edificio) cuentan una vez. */
  private densest(pts: { lon: number; lat: number }[]) {
    const locs = [...new Map(pts.map((p) => [p.lon.toFixed(5) + "," + p.lat.toFixed(5), p])).values()];
    const n = locs.length;
    if (n <= 4) return locs;
    const k = Math.min(n - 1, Math.max(4, Math.round(Math.sqrt(n))));
    const cos = Math.cos((locs[0].lat * Math.PI) / 180);
    const d2 = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => ((a.lon - b.lon) * cos) ** 2 + (a.lat - b.lat) ** 2;
    let best = locs[0], bestD = Infinity;
    for (const a of locs) {
      const d = locs.map((b) => d2(a, b)).sort((x, y) => x - y)[k];
      if (d < bestD) { bestD = d; best = a; }
    }
    return locs.map((b) => [d2(best, b), b] as const).sort((x, y) => x[0] - y[0]).slice(0, k + 1).map((x) => x[1]);
  }
  zoomToGroup(c: Card) {
    const model = this.getModel();
    if (!model) return;
    const { dep, fin } = useStore.getState();
    const passes = makePasses(model, { dep, fin });
    const idx = Array.from(c.ref.members ?? []).filter((i) => model.props[i].hasXY && passes(i));
    let pts = idx.map((i) => model.props[i]);
    if (!pts.length) return;
    if (c.kind === "sub") pts = this.densest(pts) as typeof pts;
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of pts) { b[0] = Math.min(b[0], p.lon); b[1] = Math.min(b[1], p.lat); b[2] = Math.max(b[2], p.lon); b[3] = Math.max(b[3], p.lat); }
    const pad = fitPadding(); pad.top += 30;
    if (document.body.classList.contains("panel-open") && innerWidth > 760) pad.right += document.getElementById("sidePanel")!.offsetWidth + 10;
    const minZ = c.kind === "zone" ? VIEW2 + 0.05 : VIEW3 + 0.3;
    const maxZ = c.kind === "zone" ? 15 : VIEW3 + 0.8;
    const cam = this.map.cameraForBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad, maxZoom: maxZ });
    if (!cam || !cam.center) return;
    this.map.easeTo({ center: cam.center, zoom: Math.min(Math.max(cam.zoom ?? minZ, minZ), maxZ), duration: 900 });
  }
}
