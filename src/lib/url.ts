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
