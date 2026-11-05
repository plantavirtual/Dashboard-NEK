import { CONFIG } from "../lib/constants";

export interface Session { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string } }
const KEY = "mapa-inmuebles.sesion";
const base = () => CONFIG.supabaseUrl.replace(/\/$/, "") + "/auth/v1";
const headers = () => ({ apikey: CONFIG.supabaseAnonKey, "Content-Type": "application/json" });

function guardar(raw: any): Session {
  const s: Session = {
    access_token: raw.access_token, refresh_token: raw.refresh_token,
    expires_at: raw.expires_at ?? Math.floor(Date.now() / 1000) + (raw.expires_in ?? 3600),
    user: { id: raw.user?.id ?? "", email: raw.user?.email ?? "" }
  };
  localStorage.setItem(KEY, JSON.stringify(s));
  return s;
}
async function pedir(path: string, body: unknown): Promise<Session> {
  const res = await fetch(base() + path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = String(j.error_description || j.msg || j.message || "");
    throw new Error(/invalid login/i.test(m) ? "Correo o contraseña incorrectos." : /not confirmed/i.test(m) ? "Falta confirmar el correo." : m || "No se pudo iniciar sesión.");
  }
  return guardar(j);
}

export const signIn = (email: string, password: string) => pedir("/token?grant_type=password", { email, password });

/** Sesión guardada; si el token vence en menos de un minuto se renueva con el refresh_token */
export async function restoreSession(): Promise<Session | null> {
  const txt = localStorage.getItem(KEY);
  if (!txt) return null;
  try {
    const s = JSON.parse(txt) as Session;
    if (s.expires_at - 60 > Date.now() / 1000) return s;
    return await pedir("/token?grant_type=refresh_token", { refresh_token: s.refresh_token });
  } catch { localStorage.removeItem(KEY); return null; }
}

export async function signOut(s: Session | null) {
  localStorage.removeItem(KEY);
  // Los datos en caché son privados: se borran al salir
  indexedDB.deleteDatabase("mapa-inmuebles");
  if (s) fetch(base() + "/logout", { method: "POST", headers: { ...headers(), Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
}
