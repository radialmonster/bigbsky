import { beforeEach, describe, expect, it } from "vitest";
import { isPinnedFeedMeta, pinnedFeedMetaStorageKey, pinnedFeedsStorageKey, readPinnedFeedIds, readPinnedFeedMeta, writePinnedFeedMeta } from "./feed-meta";
import { feedSources, type FeedSource } from "../sources";

const valid: FeedSource = {
  id: "at://did:plc:abc/app.bsky.feed.generator/whats-hot",
  label: "Discover",
  uri: "at://did:plc:abc/app.bsky.feed.generator/whats-hot",
  group: "Discovered",
  description: "A discovered feed.",
};

const second: FeedSource = {
  ...valid,
  id: "at://did:plc:abc/app.bsky.feed.generator/art",
  label: "Art",
  uri: "at://did:plc:abc/app.bsky.feed.generator/art",
};

const builtInId = feedSources[0]?.id ?? "discover";

beforeEach(() => {
  localStorage.clear();
});

describe("isPinnedFeedMeta", () => {
  it("accepts a well-formed discovered feed record", () => {
    expect(isPinnedFeedMeta(valid)).toBe(true);
  });

  it("accepts every persisted group, including the legacy Project alias", () => {
    for (const group of ["Core", "Official", "Discovered", "Project"] as const) {
      expect(isPinnedFeedMeta({ ...valid, group })).toBe(true);
    }
  });

  it("rejects the My Feeds group (not a persisted discovered group)", () => {
    expect(isPinnedFeedMeta({ ...valid, group: "My Feeds" })).toBe(false);
  });

  it("rejects an unknown group", () => {
    expect(isPinnedFeedMeta({ ...valid, group: "Random" })).toBe(false);
  });

  it("rejects non-object values", () => {
    expect(isPinnedFeedMeta(null)).toBe(false);
    expect(isPinnedFeedMeta(undefined)).toBe(false);
    expect(isPinnedFeedMeta("at://x")).toBe(false);
    expect(isPinnedFeedMeta(42)).toBe(false);
    // An array is typeof "object" but has no string `id`, so it is rejected.
    expect(isPinnedFeedMeta([])).toBe(false);
  });

  it("requires an id that begins with at://", () => {
    expect(isPinnedFeedMeta({ ...valid, id: "discover" })).toBe(false);
    expect(isPinnedFeedMeta({ ...valid, id: "" })).toBe(false);
  });

  it("requires id, uri, label, and description to all be strings", () => {
    expect(isPinnedFeedMeta({ ...valid, id: undefined })).toBe(false);
    expect(isPinnedFeedMeta({ ...valid, uri: undefined })).toBe(false);
    expect(isPinnedFeedMeta({ ...valid, label: undefined })).toBe(false);
    expect(isPinnedFeedMeta({ ...valid, description: undefined })).toBe(false);
    expect(isPinnedFeedMeta({ ...valid, uri: 123 })).toBe(false);
  });

  it("rejects a missing group", () => {
    const { group: _group, ...withoutGroup } = valid;
    expect(isPinnedFeedMeta(withoutGroup)).toBe(false);
  });

  it("accepts empty-string uri/label/description as long as they are strings (parity with the original guard)", () => {
    expect(isPinnedFeedMeta({ ...valid, uri: "", label: "", description: "" })).toBe(true);
  });
});

describe("readPinnedFeedMeta / writePinnedFeedMeta", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(readPinnedFeedMeta()).toEqual([]);
  });

  it("round-trips a written discovered feed through local storage", () => {
    writePinnedFeedMeta([valid]);
    expect(readPinnedFeedMeta()).toEqual([valid]);
    expect(JSON.parse(localStorage.getItem(pinnedFeedMetaStorageKey) || "[]")).toEqual([valid]);
  });

  it("overwrites the previous metadata on a later write", () => {
    writePinnedFeedMeta([valid]);
    writePinnedFeedMeta([second]);
    expect(readPinnedFeedMeta()).toEqual([second]);
  });

  it("filters malformed entries out of a stored list", () => {
    localStorage.setItem(pinnedFeedMetaStorageKey, JSON.stringify([valid, { id: "not-at" }, null, 42]));
    expect(readPinnedFeedMeta()).toEqual([valid]);
  });

  it("falls back to an empty list when the stored value is not JSON", () => {
    localStorage.setItem(pinnedFeedMetaStorageKey, "{not json");
    expect(readPinnedFeedMeta()).toEqual([]);
  });

  it("caps the stored list at 12 entries", () => {
    const many = Array.from({ length: 15 }, (_unused, index) => ({ ...valid, id: `at://did:plc:abc/app.bsky.feed.generator/f${index}` }));
    localStorage.setItem(pinnedFeedMetaStorageKey, JSON.stringify(many));
    expect(readPinnedFeedMeta()).toHaveLength(12);
  });
});

describe("readPinnedFeedIds", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(readPinnedFeedIds()).toEqual([]);
  });

  it("keeps only ids known to the static feed sources and the meta sources", () => {
    localStorage.setItem(pinnedFeedsStorageKey, JSON.stringify([builtInId, "at://did:plc:abc/app.bsky.feed.generator/unknown", valid.id]));
    expect(readPinnedFeedIds([valid])).toEqual([builtInId, valid.id]);
  });

  it("keeps ids known to the meta sources even when not in the static list", () => {
    localStorage.setItem(pinnedFeedsStorageKey, JSON.stringify([second.id]));
    expect(readPinnedFeedIds([second])).toEqual([second.id]);
  });

  it("reads the meta sources from storage by default", () => {
    localStorage.setItem(pinnedFeedMetaStorageKey, JSON.stringify([valid]));
    localStorage.setItem(pinnedFeedsStorageKey, JSON.stringify([valid.id]));
    expect(readPinnedFeedIds()).toEqual([valid.id]);
  });

  it("falls back to an empty list when the stored value is not JSON", () => {
    localStorage.setItem(pinnedFeedsStorageKey, "[broken");
    expect(readPinnedFeedIds()).toEqual([]);
  });
});
