export type RouteState =
  | { kind: "feed"; uri?: string }
  | { kind: "profile"; actor: string }
  | { kind: "post"; actor: string; rkey: string }
  | { kind: "search"; query?: string };

export function getRouteState(pathname = window.location.pathname): RouteState {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts[0] === "profile" && parts[1] && parts[2] === "post" && parts[3]) {
    return { kind: "post", actor: parts[1], rkey: parts[3] };
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

  return { kind: "feed" };
}
