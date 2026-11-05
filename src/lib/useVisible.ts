import { useMemo } from "react";
import { useStore } from "../store";
import { makePasses } from "./selectors";

/** Inmuebles que pasan los filtros actuales. Se recalcula solo cuando cambian el modelo o los filtros. */
export function useVisible() {
  const model = useStore((s) => s.model);
  const dep = useStore((s) => s.dep);
  const fin = useStore((s) => s.fin);
  return useMemo(() => {
    if (!model) return null;
    const passes = makePasses(model, { dep, fin });
    const idx: number[] = [];
    for (let i = 0; i < model.N; i++) if (passes(i)) idx.push(i);
    return { model, passes, visible: Int32Array.from(idx) };
  }, [model, dep, fin]);
}
