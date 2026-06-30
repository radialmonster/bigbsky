// Behavioral tests for getRouteState — the URL → RouteState parser. These
// exercise the real shipped helper against the path shapes BigBsky routes plus
// the robustness cases from the code review: trailing/duplicate slashes and
// non-lowercase keyword segments.

import { afterEach, describe, expect, it, vi } from "vitest";
import { getRouteState } from "./router";

// getRouteState reads window.location.search for the search query. Drive it via
// history.replaceState, which actually updates window.location under jsdom.
function withSearch(search: string, run: () => void) {
  const original = window.location.pathname + window.location.search;
  window.history.replaceState({}, "", `/search${search}`);
  try {
    run();
  } finally {
    window.history.replaceState({}, "", original);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getRouteState", () => {
  it("parses a post route, preserving actor and rkey case", () => {
    expect(getRouteState("/profile/Alice.bsky.social/post/AbC123")).toEqual({
      kind: "post",
      actor: "Alice.bsky.social",
      rkey: "AbC123",
    });
  });

  it("parses a profile route", () => {
    expect(getRouteState("/profile/bob.bsky.social")).toEqual({ kind: "profile", actor: "bob.bsky.social" });
  });

  it("maps bare /profile to the self-profile surface", () => {
    expect(getRouteState("/profile")).toEqual({ kind: "surface", name: "profile" });
  });

  it("parses a feed route, preserving the feed uri case", () => {
    const uri = "at://did:plc:Xyz/app.bsky.feed.generator/Whats-Hot";
    expect(getRouteState(`/feed/${encodeURIComponent(uri)}`)).toEqual({ kind: "feed", uri });
  });

  it("parses a search route with the q param", () => {
    withSearch("?q=hello%20world", () => {
      expect(getRouteState("/search")).toEqual({ kind: "search", query: "hello world" });
    });
  });

  it("parses a search route with no q param", () => {
    withSearch("", () => {
      expect(getRouteState("/search")).toEqual({ kind: "search", query: undefined });
    });
  });

  it("parses the oauth callback surface", () => {
    expect(getRouteState("/oauth/callback")).toEqual({ kind: "surface", name: "oauth-callback" });
  });

  it("parses each standalone surface", () => {
    for (const name of ["explore", "feeds", "notifications", "chat", "lists", "bookmarks", "settings", "info"]) {
      expect(getRouteState(`/${name}`)).toEqual({ kind: "surface", name });
    }
  });

  it("falls back to the default feed route for the home path and unknown paths", () => {
    expect(getRouteState("/")).toEqual({ kind: "feed" });
    expect(getRouteState("/totally-unknown")).toEqual({ kind: "feed" });
  });

  // Robustness cases from the code review.
  it("treats trailing and duplicate slashes the same as the clean path", () => {
    expect(getRouteState("/feeds/")).toEqual({ kind: "surface", name: "feeds" });
    expect(getRouteState("//feeds")).toEqual({ kind: "surface", name: "feeds" });
    expect(getRouteState("/profile/bob.bsky.social/")).toEqual({ kind: "profile", actor: "bob.bsky.social" });
  });

  it("matches route keywords case-insensitively but normalizes the surface name to lowercase", () => {
    expect(getRouteState("/Settings")).toEqual({ kind: "surface", name: "settings" });
    expect(getRouteState("/FEEDS")).toEqual({ kind: "surface", name: "feeds" });
    expect(getRouteState("/Profile/bob.bsky.social")).toEqual({ kind: "profile", actor: "bob.bsky.social" });
    expect(getRouteState("/Profile/Alice.bsky.social/POST/AbC123")).toEqual({
      kind: "post",
      actor: "Alice.bsky.social",
      rkey: "AbC123",
    });
    expect(getRouteState("/OAuth/Callback")).toEqual({ kind: "surface", name: "oauth-callback" });
  });

  it("returns the default feed route for an undecodable path instead of throwing", () => {
    expect(getRouteState("/%E0%A4%A")).toEqual({ kind: "feed" });
  });
});
