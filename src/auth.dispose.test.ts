import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard for the SDK-disposal workaround in `src/auth.ts`
// (`disposeCachedClient`). BigBsky must call the OAuth client's async disposer
// (`[Symbol.asyncDispose]`) on sign-out instead of the public sync `dispose()`,
// because in the pinned version `dispose()` delegates to an *undefined*
// `this[Symbol.dispose]()` and throws "Symbol.dispose is not a function". These
// assertions pin exactly what that workaround depends on, so an
// `@atproto/oauth-client-browser` upgrade that changes the disposal shape fails
// here loudly instead of silently re-breaking sign-out. If this fails after an
// intentional bump: re-verify `disposeCachedClient` against the new source, then
// update `EXPECTED_VERSION` (and package.json's exact pin) once confirmed.
const EXPECTED_VERSION = "0.4.1";

const require = createRequire(import.meta.url);
const distDir = dirname(require.resolve("@atproto/oauth-client-browser"));
const pkg = JSON.parse(readFileSync(join(distDir, "..", "package.json"), "utf8")) as { version: string };
const clientSource = readFileSync(join(distDir, "browser-oauth-client.js"), "utf8");

describe("@atproto/oauth-client-browser disposal workaround", () => {
  it("stays on the exact version whose disposal behavior we verified", () => {
    // Exact-pin guard: package.json also pins this exactly, so this only trips
    // when someone manually bumps the SDK — the prompt to re-verify disposal.
    expect(pkg.version).toBe(EXPECTED_VERSION);
  });

  it("still exposes the async disposer that signOut relies on", () => {
    // The method `disposeCachedClient` invokes via the `Symbol.asyncDispose` cast.
    expect(clientSource).toMatch(/async\s*\[Symbol\.asyncDispose\]\s*\(\)\s*\{/);
  });

  it("still has the broken sync dispose() we deliberately avoid", () => {
    // `dispose()` delegates to `this[Symbol.dispose]()`...
    expect(clientSource).toMatch(/\bdispose\s*\(\)\s*\{\s*this\[Symbol\.dispose\]\(\)\s*;?\s*\}/);
    // ...but the class never defines a `[Symbol.dispose]()` method, so that call
    // throws. If a future version DEFINES it (fixing sync dispose), this trips and
    // the workaround can be simplified.
    expect(clientSource).not.toMatch(/\[Symbol\.dispose\]\s*\(\)\s*\{/);
  });
});
