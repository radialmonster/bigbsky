import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles.css";

document.documentElement.dataset.bigbskyShell = "v4";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary label="app-root">
    <App />
  </ErrorBoundary>,
);

// Gate SW registration behind production: in dev the service worker would
// otherwise cache the dev HTML (with /src/main.tsx) under the production
// cache key, and a dev->prod switch would then serve the stale dev shell until
// the cache name was bumped. Derive the script path from BASE_URL so a future
// base/subdirectory deploy registers (and scopes) the SW correctly.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error: unknown) => {
      console.warn("BigBsky service worker registration failed.", error);
    });
  });
}
