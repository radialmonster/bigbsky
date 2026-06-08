export type RouteState =
  | { kind: "feed" }
  | { kind: "profile"; actor: string }
  | { kind: "post"; actor: string; rkey: string }
  | { kind: "search" };

export function getRouteState(pathname = window.location.pathname): RouteState {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts[0] === "profile" && parts[1] && parts[2] === "post" && parts[3]) {
    return { kind: "post", actor: parts[1], rkey: parts[3] };
  }

  if (parts[0] === "profile" && parts[1]) {
    return { kind: "profile", actor: parts[1] };
  }

  if (parts[0] === "search") {
    return { kind: "search" };
  }

  return { kind: "feed" };
}
