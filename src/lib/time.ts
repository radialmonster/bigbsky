// Timestamp handling for Bluesky posts, extracted from App.tsx so it can be
// unit-tested in isolation. `createdAt` is stamped by the author's client and
// is therefore spoofable (future-dated spam, stale device clocks) while
// `indexedAt` is stamped by the AppView. Sort/group/display on a "sortAt"
// compromise — trust `createdAt` unless it claims to be in the future beyond a
// small clock-skew window, in which case fall back to `indexedAt`.
// https://docs.bsky.app/docs/advanced-guides/timestamps

import type { FeedPost } from "../api";

export const CLOCK_SKEW_WINDOW_MS = 2 * 60 * 1000;

export function parseTimestamp(value?: string) {
  if (!value) {
    return Number.NaN;
  }
  return new Date(value).getTime();
}

// The `sortAt` ISO string to trust for a post: prefer `createdAt`, but fall
// back to `indexedAt` when `createdAt` claims to be in the future beyond the
// clock-skew window. Shared by sorting (`postSortTime`) and display
// (`formatPostTime` call sites) so a future-dated/stale `createdAt` is neither
// sorted on nor shown.
export function postSortAt(post: FeedPost): string | undefined {
  const createdAtIso = post.record.createdAt;
  const indexedAtIso = post.indexedAt;
  const createdAt = parseTimestamp(createdAtIso);
  const now = Date.now();
  if (!Number.isNaN(createdAt) && createdAt <= now + CLOCK_SKEW_WINDOW_MS) {
    return createdAtIso;
  }
  if (!Number.isNaN(parseTimestamp(indexedAtIso))) {
    return indexedAtIso;
  }
  return createdAtIso;
}

export function postSortTime(post: FeedPost) {
  const sortAt = parseTimestamp(postSortAt(post));
  return Number.isNaN(sortAt) ? 0 : sortAt;
}
