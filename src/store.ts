import { create } from "zustand";
import type { ColorBy, Model } from "./data/types";

interface Toast { id: number; text: string; ms: number }

interface State {
  model: Model | null;
  loading: boolean;
  source: string;
  toast: Toast | null;

  month: number;
  colorBy: ColorBy;
  dep: string;
  fin: string;
  ptsOn: boolean;
  playing: boolean;
  selected: number;        // índice del inmueble o -1
  hoverPoint: number;      // inmueble bajo el cursor o -1
  hoverKey: string | null; // píldora (zona/subgrupo) bajo el cursor
  view: 1 | 2 | 3;

  setModel(m: Model, source: string): void;
  showToast(text: string, ms?: number): void;
  setMonth(k: number): void;
  setColorBy(c: ColorBy): void;
  setDep(d: string): void;
  setFin(f: string): void;
  togglePts(): void;
  setPlaying(p: boolean): void;
  select(i: number): void;
  setHoverPoint(i: number): void;
  setHoverKey(k: string | null): void;
  setView(v: 1 | 2 | 3): void;
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  model: null, loading: true, source: "", toast: null,
  month: 0, colorBy: "consumo", dep: "", fin: "", ptsOn: true, playing: false,
  selected: -1, hoverPoint: -1, hoverKey: null, view: 1,

  setModel(m, source) {
    const s = get();
    const prev = s.model;
    // Si llegan datos frescos sobre un modelo ya mostrado, se conserva lo que la persona estaba viendo
    const same = prev && prev.N === m.N && prev.M === m.M;
    set({
      model: m, loading: false, source,
      month: same && s.month < m.M ? s.month : m.month0,
      dep: m.deps.includes(s.dep) ? s.dep : "",
      selected: same && s.selected < m.N && prev!.props[s.selected]?.id === m.props[s.selected]?.id ? s.selected : -1,
      hoverPoint: -1
    });
  },
  showToast(text, ms = 6000) { set({ toast: { id: ++toastId, text, ms } }); },
  setMonth: (k) => set({ month: k }),
  setColorBy: (c) => set({ colorBy: c }),
  setDep: (d) => set({ dep: d }),
  setFin: (f) => set({ fin: f }),
  togglePts: () => set((s) => ({ ptsOn: !s.ptsOn, hoverPoint: s.ptsOn ? -1 : s.hoverPoint })),
  setPlaying: (p) => set({ playing: p }),
  select: (i) => set({ selected: i, hoverPoint: -1 }),
  setHoverPoint: (i) => set((s) => (s.hoverPoint === i ? s : { hoverPoint: i })),
  setHoverKey: (k) => set((s) => (s.hoverKey === k ? s : { hoverKey: k })),
  setView: (v) => set((s) => (s.view === v ? s : { view: v, hoverPoint: v === 1 ? -1 : s.hoverPoint }))
}));
