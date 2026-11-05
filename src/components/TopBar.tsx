import { useStore } from "../store";
import { nfInt } from "../lib/format";
import { useVisible } from "../lib/useVisible";
import type { ColorBy } from "../data/types";

export function TopBar({ onLogout, email, onRecibos }: { onLogout: () => void; email: string; onRecibos: () => void }) {
  const model = useStore((s) => s.model);
  const source = useStore((s) => s.source);
  const colorBy = useStore((s) => s.colorBy);
  const dep = useStore((s) => s.dep);
  const fin = useStore((s) => s.fin);
  const ptsOn = useStore((s) => s.ptsOn);
  const { setColorBy, setDep, setFin, togglePts } = useStore.getState();
  const v = useVisible();

  const count = !model ? "Cargando…"
    : dep || fin ? `${nfInt.format(v?.visible.length ?? 0)} de ${nfInt.format(model.N)} inmuebles`
    : `${nfInt.format(model.N)} inmuebles`;

  return (
    <header id="topbar">
      <div className="brand">
        <h1>Mapa de Inmuebles</h1>
        <span id="count">{count}</span>
        {source === "archivo" && <span id="sampleTag" className="tag">Muestra precargada</span>}
      </div>
      <div className="controls">
        <label className="ctl" htmlFor="colorSel"><span>Colorear por</span>
          <select id="colorSel" value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)}>
            <optgroup label="Medidas del recibo">
              <option value="consumo">Consumo (kWh)</option>
              <option value="precio">Precio por kWh</option>
              <option value="demanda">Demanda (kW)</option>
            </optgroup>
            <optgroup label="Características">
              <option value="dependencia">Dependencia</option>
              <option value="tarifa">Tarifa</option>
              <option value="interconexion">Interconexión</option>
              <option value="ubicacion">Ubicación validada</option>
            </optgroup>
          </select>
        </label>
        <label className="ctl" htmlFor="depSel"><span>Dependencia</span>
          <select id="depSel" value={dep} onChange={(e) => setDep(e.target.value)}>
            <option value="">Todas</option>
            {model?.deps.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="ctl" htmlFor="finSel"><span>Fin del recibo</span>
          <select id="finSel" value={fin} onChange={(e) => setFin(e.target.value)}>
            <option value="">Todos</option>
            <option value="enefeb">Enero o febrero 2026</option>
            <option value="2026-01">Enero 2026</option>
            <option value="2026-02">Febrero 2026</option>
            <option value="otro">Otro mes</option>
          </select>
        </label>
        <label className="sw" htmlFor="ptsSw"><span>Inmuebles</span>
          <button id="ptsSw" type="button" role="switch" aria-checked={ptsOn} onClick={togglePts}
            aria-label={ptsOn ? "Ocultar los puntos de inmuebles" : "Mostrar los puntos de inmuebles"} />
        </label>
        <button id="recibosBtn" type="button" onClick={onRecibos}>Recibos</button>
        {email && <button id="logout" type="button" title={email} onClick={onLogout}>Salir</button>}
      </div>
    </header>
  );
}
