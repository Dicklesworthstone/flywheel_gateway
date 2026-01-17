import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./index.css";

// React Compiler runtime marker (dev mode only)
if (import.meta.env.DEV && !import.meta.env.VITE_DISABLE_COMPILER) {
  console.debug("[Compiler] React Compiler enabled");
}

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
