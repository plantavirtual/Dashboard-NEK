import { useEffect } from "react";
import { useStore } from "../store";

export function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.setState({ toast: null }), toast.ms);
    return () => clearTimeout(t);
  }, [toast]);
  return toast ? <div id="toast" role="status">{toast.text}</div> : null;
}
