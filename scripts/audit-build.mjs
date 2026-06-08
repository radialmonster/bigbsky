import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = "dist";
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
    }
  }
}

walk(root);

if (failures.length > 0) {
  throw new Error(`Build audit failed: forbidden runtime artifacts found: ${failures.join(", ")}`);
}

console.log("Build audit passed: static-only dist output.");
