import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";

const root = "dist";
// Initial reader-shell JS budget (gzip). The plan's hard target is <250 kB for
// the first reader shell; this guardrail is stricter to catch creep early. It
// was bumped from 100→110 kB when the authenticated Lists/block-list curation UI
// landed in the main chunk, to 111 kB when media density plus explicit
// per-feed density override controls were added to the reader/settings shell,
// and to 112 kB when the media viewer gained browser Back-button handling.
// The structural fix (tracked in the plan's
// Performance Architecture section) is to code-split write-heavy authenticated
// surfaces — Composer, SurfaceView/Lists, account/OAuth panels — into lazy
// chunks; doing so should let this drop back toward 100 kB.
const initialJsBudgetBytes = 112 * 1024;
const initialCssBudgetBytes = 20 * 1024;
const forbiddenNames = new Set([
  "functions",
  "_worker.js",
  "middleware.js",
  "server",
  ".vercel",
  ".netlify",
]);
const forbiddenPatterns = [/server-entry/i, /edge-runtime/i, /ssr-manifest/i, /api[/\\]/i];

if (!existsSync(root)) {
  throw new Error("Build audit failed: dist does not exist.");
}

const failures = [];
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const relativePath = relative(root, fullPath);
    const normalized = relativePath.split(sep).join("/");

    if (forbiddenNames.has(entry) || forbiddenPatterns.some((pattern) => pattern.test(normalized))) {
      failures.push(normalized);
    }

    if (statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else {
      files.push(normalized);
    }
  }
}

walk(root);

function requireFile(path) {
  if (!existsSync(join(root, path))) {
    failures.push(`missing:${path}`);
  }
}

requireFile("index.html");
requireFile("_redirects");
requireFile("oauth-client-metadata.json");
requireFile("sw.js");
requireFile("icon.svg");
requireFile("site.webmanifest");

if (existsSync(join(root, "_redirects"))) {
  const redirects = readFileSync(join(root, "_redirects"), "utf8");
  if (!redirects.split(/\r?\n/).some((line) => line.trim() === "/* /index.html 200")) {
    failures.push("_redirects:missing-spa-fallback");
  }
}

if (existsSync(join(root, "oauth-client-metadata.json"))) {
  const metadata = JSON.parse(readFileSync(join(root, "oauth-client-metadata.json"), "utf8"));
  const callbacks = Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris : [];
  if (!callbacks.some((uri) => typeof uri === "string" && uri.includes("/oauth/callback"))) {
    failures.push("oauth-client-metadata.json:missing-callback");
  }
  if (metadata.logo_uri !== "https://bigbsky.com/icon.svg") {
    failures.push("oauth-client-metadata.json:missing-logo-uri");
  }
}

const initialAssets = {
  js: [],
  css: [],
};

if (existsSync(join(root, "index.html"))) {
  const index = readFileSync(join(root, "index.html"), "utf8");
  for (const match of index.matchAll(/(?:src|href)="\/([^"]+\.(js|css))"/g)) {
    initialAssets[match[2]].push(match[1]);
  }
}

function gzipSize(path) {
  return gzipSync(readFileSync(join(root, path))).length;
}

const initialJsGzip = initialAssets.js.reduce((total, path) => total + gzipSize(path), 0);
const initialCssGzip = initialAssets.css.reduce((total, path) => total + gzipSize(path), 0);

if (initialJsGzip > initialJsBudgetBytes) {
  failures.push(`initial-js-gzip:${initialJsGzip}`);
}

if (initialCssGzip > initialCssBudgetBytes) {
  failures.push(`initial-css-gzip:${initialCssGzip}`);
}

if (failures.length > 0) {
  throw new Error(`Build audit failed: forbidden runtime artifacts found: ${failures.join(", ")}`);
}

console.log(
  `Build audit passed: static-only dist output (${files.length} files, initial JS ${Math.round(
    initialJsGzip / 1024,
  )} kB gzip, initial CSS ${Math.round(initialCssGzip / 1024)} kB gzip).`,
);
