import { describe, expect, it } from "vitest";
import { isAdultPost, isSensitiveLabel, moderationLabelText, sensitiveMediaValues } from "./moderation";
import type { FeedPost } from "../api";

describe("moderationLabelText", () => {
  it("formats a plain label value as title-cased words", () => {
    expect(moderationLabelText({ val: "sexual" })).toBe("Sexual");
    expect(moderationLabelText({ val: "content_warning" })).toBe("Content Warning");
    expect(moderationLabelText({ val: "porn" })).toBe("Porn");
  });

  it("strips a leading bang and normalizes separators", () => {
    expect(moderationLabelText({ val: "!no-spoilers" })).toBe("No Spoilers");
    expect(moderationLabelText({ val: "adult_content" })).toBe("Adult Content");
  });

  it("trims surrounding whitespace before formatting", () => {
    expect(moderationLabelText({ val: "  graphic " })).toBe("Graphic");
  });

  it("falls back to a neutral label for empty/missing values", () => {
    expect(moderationLabelText({ val: "" })).toBe("Content label");
    expect(moderationLabelText({ val: "   " })).toBe("Content label");
    expect(moderationLabelText({})).toBe("Content label");
  });
});

describe("isSensitiveLabel", () => {
  it("flags adult/graphic/gore/nudity/porn/sexual/spam/violence terms", () => {
    for (const term of ["adult", "graphic", "gore", "nudity", "porn", "sexual", "spam", "violence"]) {
      expect(isSensitiveLabel({ val: term })).toBe(true);
    }
  });

  it("matches case-insensitively and as substrings", () => {
    expect(isSensitiveLabel({ val: "Sexual" })).toBe(true);
    expect(isSensitiveLabel({ val: "pornographic" })).toBe(true);
    expect(isSensitiveLabel({ val: "nudity-r18" })).toBe(true);
  });

  it("does not flag benign labels", () => {
    expect(isSensitiveLabel({ val: "creator" })).toBe(false);
    expect(isSensitiveLabel({ val: "news" })).toBe(false);
    expect(isSensitiveLabel({ val: "" })).toBe(false);
    expect(isSensitiveLabel({})).toBe(false);
  });
});

describe("sensitiveMediaValues", () => {
  it("dedupes and normalizes matching labels, dropping spam", () => {
    expect(sensitiveMediaValues([{ val: "adult" }, { val: "ADULT" }, { val: "spam" }])).toEqual(["adult"]);
  });

  it("filters out non-sensitive labels and empty values", () => {
    expect(sensitiveMediaValues([{ val: "creator" }, { val: "" }, { val: "graphic" }])).toEqual(["graphic"]);
  });

  it("returns an empty array when nothing is sensitive", () => {
    expect(sensitiveMediaValues([{ val: "news" }, { val: "funny" }])).toEqual([]);
    expect(sensitiveMediaValues([])).toEqual([]);
  });
});

describe("isAdultPost", () => {
  const makePost = (labels: Array<{ val?: string }>, authorLabels: Array<{ val?: string }> = []): FeedPost => ({
    uri: "at://did:plc:author/app.bsky.feed.post/abc",
    cid: "cid-1",
    author: { did: "did:plc:author", handle: "author.bsky.social", displayName: "Author", labels: authorLabels },
    record: { text: "hello", createdAt: "2026-01-01T00:00:00.000Z" },
    labels,
  });

  it("flags a post carrying an adult/graphic media label", () => {
    expect(isAdultPost(makePost([{ val: "adult" }]))).toBe(true);
    expect(isAdultPost(makePost([{ val: "graphic" }]))).toBe(true);
  });

  it("flags a post whose author carries an adult/graphic label", () => {
    expect(isAdultPost(makePost([], [{ val: "porn" }]))).toBe(true);
  });

  it("ignores non-sensitive labels", () => {
    expect(isAdultPost(makePost([{ val: "news" }]))).toBe(false);
    expect(isAdultPost(makePost([]))).toBe(false);
  });
});
