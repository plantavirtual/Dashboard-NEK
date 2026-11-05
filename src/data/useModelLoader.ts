import { useEffect } from "react";
import { useStore } from "../store";
import type { WorkerOut } from "./model.worker";
import type { Session } from "../auth/auth";

/** Arranca el worker en cuanto se monta la app, en paralelo con la creación del mapa */
export function useModelLoader(session: Session, onAuthError: () => void) {
  useEffect(() => {
    const w = new Worker(new URL("./model.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      const st = useStore.getState();
      if (m.type === "model") st.setModel(m.model, m.source);
      else if (m.type === "toast") st.showToast(m.text, m.ms);
      else if (m.type === "auth") onAuthError();
    };
    w.postMessage({ type: "load", token: session.access_token, uid: session.user.id });
    return () => w.terminate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
