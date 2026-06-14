import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    // The two chunks that exceed Rollup's default 500 kB heuristic are the
    // `@atproto/api` Agent (~850 kB, authenticated writes) and `hls.js` (~525 kB,
    // video playback). Both are already lazy-loaded via dynamic import(), so they
    // never enter the initial reader shell — the entry bundle is ~113 kB gzip,
    // well under the hard budget enforced by scripts/audit-build.mjs. Rollup's
    // automatic code-splitting already isolates them (and the OAuth client) into
    // their own chunks, sharing common `@atproto/*` deps optimally; forcing
    // manualChunks here would risk coupling those shared deps back together. So
    // we leave chunking automatic and raise the warning limit just above these
    // intentional lazy vendor chunks. The metric that actually matters — the
    // initial-shell gzip size — stays guarded by the build audit.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
