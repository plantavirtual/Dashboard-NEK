import { FEATURE_LABEL } from "./constants";
import type { CatMode, Prop } from "../data/types";

export function catLabel(p: Prop, mode: CatMode): string {
  if (mode === "dependencia") return p.dependencia;
  if (mode === "tarifa") return p.tarifa || "Sin tarifa";
  if (mode === "interconexion") return p.feature ? FEATURE_LABEL[p.feature] || p.feature : "Sin interconexión";
  return p.valid === true ? "Validada" : p.valid === false ? "Sin validar" : "Sin dato";
}
