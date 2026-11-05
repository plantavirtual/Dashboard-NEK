import { lazy, Suspense, useEffect, useState } from "react";
import { useRoute } from "./route";
import { useModelLoader } from "./data/useModelLoader";
import { TopBar } from "./components/TopBar";
import { Login } from "./components/Login";
import { MapStage } from "./map/MapStage";
import { restoreSession, signOut, type Session } from "./auth/auth";
import { CONFIG } from "./lib/constants";

const Dashboard = lazy(() => import("./dash/Dashboard").then((m) => ({ default: m.Dashboard })));

function Authed({ session, onLogout }: { session: Session; onLogout: () => void }) {
  useModelLoader(session, onLogout);   // los datos se cargan una vez y los comparten el mapa y los recibos
  const [route, go] = useRoute();
  if (route === "recibos") return <Suspense fallback={null}><Dashboard onBack={() => go("mapa")} /></Suspense>;
  return (
    <div id="app">
      <TopBar onLogout={onLogout} email={session.user.email} onRecibos={() => go("recibos")} />
      <MapStage />
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => { restoreSession().then((s) => { setSession(s); setChecking(false); }); }, []);

  // Modo archivo local (VITE_DATOS_URL): sin Supabase, sin login
  if (CONFIG.datosUrl) return <Authed session={{ access_token: "", refresh_token: "", expires_at: 0, user: { id: "local", email: "" } }} onLogout={() => {}} />;
  if (checking) return null;
  if (!session) return <Login onLogin={setSession} />;
  return <Authed session={session} onLogout={() => { void signOut(session); setSession(null); location.reload(); }} />;
}
