import type { ReactNode } from "react";
import { MES_CORTO } from "../lib/constants";
import { niceMax, shortNum, keyLabel } from "../lib/format";

export interface Prom { todo: number; doce: number; n12: number; ini: string | null }

/** Una barra por mes del historial completo (keys = "AAAA-MM"). El mes elegido en la línea de tiempo se resalta
    y al tocar una barra se cambia el mes del mapa. */
export function Chart(p: {
  title: ReactNode; unit: string; keys: string[]; vals: number[]; color: string; fmt: (v: number) => string;
  emptyText: string; prom: Prom; selKey: string; tIndex: Map<string, number>;
}) {
  const { keys, vals, color, fmt, prom, selKey, tIndex } = p;
  const n = keys.length;
  if (!vals.some(isFinite)) {
    return <div className="chart"><h4><i className="t">{p.title}</i><span>{p.unit}</span></h4><div className="empty">{p.emptyText}</div></div>;
  }
  const W = 360, H = 128, L = 34, R = 6, T = 10, B = 22;
  const max = niceMax(Math.max(...vals.filter(isFinite)));
  const avg = prom.todo;
  const bw = (W - L - R) / n, barW = Math.min(bw * 0.64, 40);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const cada = n <= 13 ? 1 : Math.ceil(n / 7);
  const si = keys.indexOf(selKey);
  const doce = prom.doce;
  const linea = (dash: boolean) => (
    <svg viewBox="0 0 14 6" aria-hidden="true"><line x1="0" x2="14" y1="3" y2="3" stroke={dash ? "#7b8cde" : "#4f5fb8"} strokeWidth={dash ? 1.2 : 1.8} strokeDasharray={dash ? "4 3" : undefined} /></svg>
  );
  return (
    <div className="chart">
      <h4><i className="t">{p.title}</i><span>{p.unit}</span></h4>
      <div className="proms">
        <span>{linea(false)}Últimos 12 meses{prom.n12 < 12 ? ` (${prom.n12} con dato)` : ""}: <b>{isFinite(doce) ? fmt(doce) : "—"}</b></span>
        <span>{linea(true)}Todo el historial: <b>{isFinite(avg) ? fmt(avg) : "—"}</b></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${typeof p.title === "string" ? p.title : p.unit} por mes`}>
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#e5e6ee" />
        <line x1={L} x2={W - R} y1={y(max / 2)} y2={y(max / 2)} stroke="#f0f1f5" />
        <line x1={L} x2={W - R} y1={y(max)} y2={y(max)} stroke="#f0f1f5" />
        <text x={L - 6} y={y(max) + 3} textAnchor="end">{shortNum(max)}</text>
        <text x={L - 6} y={y(max / 2) + 3} textAnchor="end">{shortNum(max / 2)}</text>
        <text x={L - 6} y={y(0) + 3} textAnchor="end">0</text>
        {si >= 0 && <rect x={L + si * bw} y={T - 4} width={bw} height={H - T - B + 4} rx={Math.min(4, bw / 2)} fill="#e8ebfa" />}
        {keys.map((key, j) => {
          const v = vals[j], x = L + j * bw + (bw - barW) / 2, sel = key === selKey;
          const k = tIndex.has(key) ? String(tIndex.get(key)) : "";
          const tip = `${keyLabel(key)}: ${isFinite(v) ? fmt(v) : "sin registro"}`;
          const [yy, mm] = key.split("-").map(Number);
          return (
            <g key={key}>
              {isFinite(v)
                ? <rect className="bar" data-k={k} data-tip={tip} x={x} y={y(v)} width={barW} height={Math.max(1, y(0) - y(v))} rx={Math.min(2, barW / 3)} fill={color} stroke={sel ? "#4f5fb8" : undefined} strokeWidth={sel ? 1.5 : undefined} />
                : <rect className="bar" data-k={k} data-tip={tip} x={x} y={y(0) - 3} width={barW} height={3} rx={1} fill="#c3c5cf" />}
              <rect className="bar" data-k={k} data-tip={tip} x={L + j * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
              {j % cada === 0 && (
                <text x={L + j * bw + bw / 2} y={H - 7} textAnchor="middle" style={sel ? { fill: "#4f5fb8", fontWeight: 700 } : undefined}>
                  {MES_CORTO[mm - 1]}{n > 13 || n <= 4 ? " " + String(yy).slice(2) : ""}
                </text>
              )}
            </g>
          );
        })}
        {isFinite(avg) && <line x1={L} x2={W - R} y1={y(avg)} y2={y(avg)} stroke="#7b8cde" strokeWidth={1.2} strokeDasharray="4 3" />}
        {isFinite(doce) && <line x1={L + Math.max(0, keys.indexOf(prom.ini ?? "")) * bw} x2={W - R} y1={y(doce)} y2={y(doce)} stroke="#4f5fb8" strokeWidth={1.8} />}
      </svg>
    </div>
  );
}
