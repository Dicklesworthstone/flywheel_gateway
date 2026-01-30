import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./index.css";

const gatewayToken = import.meta.env["VITE_GATEWAY_TOKEN"]?.trim();
if (gatewayToken) {
  const originalFetch = window.fetch;

  window.fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      const shouldAttachAuth =
        url.startsWith("/api") ||
        url.startsWith(`${window.location.origin}/api`);
      if (!shouldAttachAuth) {
        return originalFetch(input, init);
      }

      const mergedHeaders = new Headers(
        input instanceof Request ? input.headers : undefined,
      );
      const initHeaders = new Headers(init?.headers);
      initHeaders.forEach((value, key) => {
        mergedHeaders.set(key, value);
      });
      if (!mergedHeaders.has("Authorization")) {
        mergedHeaders.set("Authorization", `Bearer ${gatewayToken}`);
      }

      if (input instanceof Request) {
        return originalFetch(
          new Request(input, { ...init, headers: mergedHeaders }),
        );
      }

      return originalFetch(input, { ...init, headers: mergedHeaders });
    },
    originalFetch,
  );
}

// React Compiler runtime marker (dev mode only)
if (import.meta.env["DEV"] && !import.meta.env["VITE_DISABLE_COMPILER"]) {
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
