export type RouteState =
  | { kind: "feed"; uri?: string }
  | { kind: "profile"; actor: string }
  | { kind: "post"; actor: string; rkey: string }
  | { kind: "search"; query?: string }
  | { kind: "surface"; name: string };

// Standalone navigation surfaces (no actor/rkey/uri params). Hoisted to module
// scope so it isn't re-allocated on every getRouteState call.
const SURFACES = new Set(["explore", "feeds", "notifications", "chat", "lists", "bookmarks", "settings", "info"]);

export function getRouteState(pathname = window.location.pathname): RouteState {
  let parts: string[];
  try {
    // filter(Boolean) drops empty segments, so leading/trailing/duplicate
    // slashes (e.g. "/feeds/", "//feeds") collapse to the same route.
    parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return { kind: "feed" };
  }

  // Route *keywords* (profile/feed/post/search/oauth/callback/surface names) are
  // matched case-insensitively so "/Settings" or "/Profile/foo" resolve. Actor
  // handles, rkeys, and the search query keep their original case — handles are
  // normalized elsewhere and rkeys are case-sensitive.
  const seg0 = parts[0]?.toLowerCase();
  const seg2 = parts[2]?.toLowerCase();

  if (seg0 === "profile" && parts[1] && seg2 === "post" && parts[3]) {
    return { kind: "post", actor: parts[1], rkey: parts[3] };
  }

  if (seg0 === "profile" && !parts[1]) {
    return { kind: "surface", name: "profile" };
  }

  if (seg0 === "profile" && parts[1]) {
    return { kind: "profile", actor: parts[1] };
  }

  if (seg0 === "feed" && parts[1]) {
    return { kind: "feed", uri: parts[1] };
  }

  if (seg0 === "search") {
    return { kind: "search", query: new URLSearchParams(window.location.search).get("q") || undefined };
  }

  if (seg0 === "oauth" && parts[1]?.toLowerCase() === "callback") {
    return { kind: "surface", name: "oauth-callback" };
  }

  if (seg0 && SURFACES.has(seg0)) {
    return { kind: "surface", name: seg0 };
  }

  return { kind: "feed" };
}
