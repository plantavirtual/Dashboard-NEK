import { useState, type FormEvent } from "react";
import { signIn, type Session } from "../auth/auth";

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { onLogin(await signIn(email.trim(), pass)); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  };
  return (
    <div id="login">
      <form onSubmit={submit}>
        <h1>Mapa de Inmuebles</h1>
        <p>Inicia sesión para ver los datos.</p>
        <label>Correo<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Contraseña<input type="password" autoComplete="current-password" required value={pass} onChange={(e) => setPass(e.target.value)} /></label>
        {error && <div className="err" role="alert">{error}</div>}
        <button type="submit" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </div>
  );
}
