export type RouteState =
  | { kind: "feed"; uri?: string }
  | { kind: "profile"; actor: string }
  | { kind: "post"; actor: string; rkey: string }
  | { kind: "search"; query?: string }
  | { kind: "surface"; name: string };

export function getRouteState(pathname = window.location.pathname): RouteState {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts[0] === "profile" && parts[1] && parts[2] === "post" && parts[3]) {
    return { kind: "post", actor: parts[1], rkey: parts[3] };
  }

  if (parts[0] === "profile" && !parts[1]) {
    return { kind: "surface", name: "profile" };
  }

  if (parts[0] === "profile" && parts[1]) {
    return { kind: "profile", actor: parts[1] };
  }

  if (parts[0] === "feed" && parts[1]) {
    return { kind: "feed", uri: parts[1] };
  }

  if (parts[0] === "search") {
    return { kind: "search", query: new URLSearchParams(window.location.search).get("q") || undefined };
  }

  if (parts[0] === "oauth" && parts[1] === "callback") {
    return { kind: "surface", name: "oauth-callback" };
  }

  const surfaces = new Set(["explore", "feeds", "notifications", "chat", "lists", "bookmarks", "settings", "info"]);
  if (parts[0] && surfaces.has(parts[0])) {
    return { kind: "surface", name: parts[0] };
  }

  return { kind: "feed" };
}
