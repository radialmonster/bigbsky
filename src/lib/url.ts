import type { MouseEvent as ReactMouseEvent } from "react";

// Minimal http(s) URL guard shared across the app.
//
// A value is only returned when it parses as an absolute URL whose scheme is
// http: or https:. Everything else — empty/nullish input, unparseable strings,
// and non-web schemes (javascript:, data:, file:, at:, did:, mailto:, …) —
// yields `undefined`. Callers use this both as a render-time safety gate (a
// facet link with a non-web uri is downgraded to plain text instead of a
// clickable anchor) and to sanitize avatar/blob/external-embed URLs. Returns
// the normalized `url.href` so callers get a canonical form.

export function safeHttpUrl(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// Canonical bsky.app permalink for a post (falls back to the author's profile
// when the record key cannot be derived from the at:// URI).
export function postBskyUrl(post: { uri: string; author: { handle: string } }): string {
  const rkey = post.uri.split("/").pop();
  return rkey ? `https://bsky.app/profile/${post.author.handle}/post/${rkey}` : `https://bsky.app/profile/${post.author.handle}`;
}

// In-app SPA route to a post's thread view.
export function postPath(post: { uri: string; author: { handle: string } }) {
  const rkey = post.uri.split("/").pop();
  return rkey ? `/profile/${encodeURIComponent(post.author.handle)}/post/${encodeURIComponent(rkey)}` : null;
}

// In-app SPA route to an author's profile.
export function profilePath(profile: { handle?: string; did: string }) {
  const actor = profile.handle || profile.did;
  return `/profile/${encodeURIComponent(actor)}`;
}

// Guard for in-app link clicks: ignore modified-clicks and non-primary buttons
// so the browser's default behavior (new tab, text selection, etc.) survives,
// and only intercept plain left-clicks to navigate within the SPA shell.
export function handleInternalLinkClick(event: ReactMouseEvent<HTMLAnchorElement>, navigate: () => void) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  navigate();
}
