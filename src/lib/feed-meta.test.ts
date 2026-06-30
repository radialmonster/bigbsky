import { describe, expect, it } from "vitest";
import { isPinnedFeedMeta } from "./feed-meta";
import type { FeedSource } from "../sources";

const valid: FeedSource = {
  id: "at://did:plc:abc/app.bsky.feed.generator/whats-hot",
  label: "Discover",
  uri: "at://did:plc:abc/app.bsky.feed.generator/whats-hot",
  group: "Discovered",
  description: "A discovered feed.",
};

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
