import { createRoot } from "react-dom/client";
import "@fontsource/lato/300.css";
import "@fontsource/lato/400.css";
import "@fontsource/lato/400-italic.css";
import "@fontsource/lato/700.css";
import "@fontsource/lato/900.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { App } from "./App";

// Sin StrictMode a propósito: el mapa y el worker se crean una sola vez
createRoot(document.getElementById("root")!).render(<App />);
