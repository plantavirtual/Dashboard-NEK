import { useEffect, useState } from "react";

export type Route = "mapa" | "recibos";
const read = (): Route => (location.hash === "#recibos" ? "recibos" : "mapa");

/** Rutas por hash (#recibos): sin librería de rutas y sin configurar el servidor */
export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const f = () => setRoute(read());
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return [route, (r) => { location.hash = r; }];
}
