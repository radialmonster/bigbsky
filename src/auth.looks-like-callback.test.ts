import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { looksLikeOAuthCallback } from "./auth";

// Behavioral suite for looksLikeOAuthCallback (#4). BigBsky uses the atproto
// SDK's default "fragment" response mode, so real callbacks land in the hash on
// a redirect-URI path (/oauth/callback in production, "/" on a loopback origin).
// The path gate is what stops a stray #state=…&error=… fragment on any other
// route from falsely tripping the callback view. jsdom lets us retarget the
// window URL with history.replaceState (same-origin only — the function only
// reads pathname/search/hash, so the host is irrelevant to the assertions).
describe("looksLikeOAuthCallback", () => {
  const originalUrl = window.location.href;

  beforeEach(() => {
    window.history.replaceState({}, "", originalUrl);
  });

  afterEach(() => {
    window.history.replaceState({}, "", originalUrl);
  });

  it("detects a fragment-mode callback on the production redirect path", () => {
    window.history.replaceState({}, "", "/oauth/callback#state=abc&code=xyz");
    expect(looksLikeOAuthCallback()).toBe(true);
  });

  it("detects a fragment-mode error callback on the redirect path", () => {
    window.history.replaceState({}, "", "/oauth/callback#state=abc&error=access_denied");
    expect(looksLikeOAuthCallback()).toBe(true);
  });

  it("detects a query-mode callback on the redirect path (search fallback)", () => {
    window.history.replaceState({}, "", "/oauth/callback?state=abc&code=xyz");
    expect(looksLikeOAuthCallback()).toBe(true);
  });

  it("ignores a stray callback fragment on a non-redirect route (the #4 false trigger)", () => {
    window.history.replaceState({}, "", "/feed/following#state=abc&code=xyz");
    expect(looksLikeOAuthCallback()).toBe(false);
  });

  it("ignores a stray callback fragment on the profile route", () => {
    window.history.replaceState({}, "", "/profile/me.bsky.social#state=abc&error=access_denied");
    expect(looksLikeOAuthCallback()).toBe(false);
  });

  it("detects a fragment-mode callback on the loopback root (dev server)", () => {
    // The loopback client id redirects to "/" on a loopback origin (localhost).
    window.history.replaceState({}, "", "/#state=abc&code=xyz");
    expect(looksLikeOAuthCallback()).toBe(true);
  });

  it("requires state", () => {
    window.history.replaceState({}, "", "/oauth/callback#code=xyz");
    expect(looksLikeOAuthCallback()).toBe(false);
  });

  it("requires code or error alongside state", () => {
    window.history.replaceState({}, "", "/oauth/callback#state=abc&iss=https%3A%2F%2Fbsky.social");
    expect(looksLikeOAuthCallback()).toBe(false);
  });

  it("returns false with no callback params at all", () => {
    window.history.replaceState({}, "", "/feed/following");
    expect(looksLikeOAuthCallback()).toBe(false);
  });
});
