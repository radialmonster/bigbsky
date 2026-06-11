import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

document.documentElement.dataset.bigbskyShell = "v3";

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.warn("BigBSky service worker registration failed.", error);
    });
  });
}
