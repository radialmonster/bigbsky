// Behavioral tests for the post-timestamp "sortAt" logic extracted from
// App.tsx. These exercise the real shipped helpers (not a re-implementation)
// against the edge cases the Bluesky timestamp docs call out: spoofable
// future-dated `createdAt`, missing/unparseable values, and the clock-skew
// tolerance window. https://docs.bsky.app/docs/advanced-guides/timestamps

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedPost } from "../api";
import { CLOCK_SKEW_WINDOW_MS, parseTimestamp, postSortAt, postSortTime } from "./time";

// `postSortAt`/`postSortTime` read only `record.createdAt` and `indexedAt`, so
// a minimal post shape is enough to drive every branch.
function makePost(createdAt?: string, indexedAt?: string): FeedPost {
  return { record: { createdAt }, indexedAt } as FeedPost;
}

const NOW = new Date("2026-06-26T12:00:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseTimestamp", () => {
  it("parses a valid ISO string to epoch millis", () => {
    expect(parseTimestamp("2026-06-26T12:00:00.000Z")).toBe(NOW);
  });

  it("returns NaN for undefined", () => {
    expect(parseTimestamp(undefined)).toBeNaN();
  });

  it("returns NaN for an empty string", () => {
    expect(parseTimestamp("")).toBeNaN();
  });

  it("returns NaN for an unparseable string", () => {
    expect(parseTimestamp("not-a-date")).toBeNaN();
  });
});

describe("postSortAt", () => {
  it("prefers createdAt when it is in the past", () => {
    const post = makePost("2026-06-26T11:00:00.000Z", "2026-06-26T11:30:00.000Z");
    expect(postSortAt(post)).toBe("2026-06-26T11:00:00.000Z");
  });

  it("prefers createdAt when it is exactly now", () => {
    const post = makePost("2026-06-26T12:00:00.000Z", "2026-06-26T11:00:00.000Z");
    expect(postSortAt(post)).toBe("2026-06-26T12:00:00.000Z");
  });

  it("still trusts createdAt when it is in the future but within the clock-skew window", () => {
    const within = new Date(NOW + CLOCK_SKEW_WINDOW_MS - 1_000).toISOString();
    const post = makePost(within, "2026-06-26T11:00:00.000Z");
    expect(postSortAt(post)).toBe(within);
  });

  it("trusts createdAt at exactly the edge of the clock-skew window", () => {
    const edge = new Date(NOW + CLOCK_SKEW_WINDOW_MS).toISOString();
    const post = makePost(edge, "2026-06-26T11:00:00.000Z");
    expect(postSortAt(post)).toBe(edge);
  });

  it("falls back to indexedAt when createdAt is in the future beyond the skew window", () => {
    const future = new Date(NOW + CLOCK_SKEW_WINDOW_MS + 1_000).toISOString();
    const post = makePost(future, "2026-06-26T11:00:00.000Z");
    expect(postSortAt(post)).toBe("2026-06-26T11:00:00.000Z");
  });

  it("falls back to indexedAt when createdAt is missing", () => {
    const post = makePost(undefined, "2026-06-26T11:00:00.000Z");
    expect(postSortAt(post)).toBe("2026-06-26T11:00:00.000Z");
  });

  it("keeps the far-future createdAt when indexedAt is unparseable (degrades, never throws)", () => {
    const future = new Date(NOW + CLOCK_SKEW_WINDOW_MS + 1_000).toISOString();
    const post = makePost(future, undefined);
    expect(postSortAt(post)).toBe(future);
  });

  it("returns undefined when neither timestamp is present", () => {
    expect(postSortAt(makePost(undefined, undefined))).toBeUndefined();
  });
});

describe("postSortTime", () => {
  it("returns the chosen sortAt as epoch millis", () => {
    const post = makePost("2026-06-26T11:00:00.000Z");
    expect(postSortTime(post)).toBe(new Date("2026-06-26T11:00:00.000Z").getTime());
  });

  it("returns 0 when no timestamp resolves", () => {
    expect(postSortTime(makePost(undefined, undefined))).toBe(0);
  });

  it("orders an older post before a newer one", () => {
    const older = makePost("2026-06-26T10:00:00.000Z");
    const newer = makePost("2026-06-26T11:00:00.000Z");
    expect(postSortTime(older)).toBeLessThan(postSortTime(newer));
  });
});
