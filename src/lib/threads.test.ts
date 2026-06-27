// Behavioral tests for the thread logic extracted from App.tsx. These exercise
// the real shipped helpers against the cases that actually bite: native
// reply-chain reassembly (no "1/n" markers written — bsky native threads are
// pure reply chains), the per-hop continuation time window, grapheme-aware
// splitting, and the read-only marker recognition for other clients' threads.

import { describe, expect, it } from "vitest";
import type { FeedItem, FeedPost, ThreadNode, ThreadPostNode } from "../api";
import {
  CONTINUATION_REPLY_WINDOW_MS,
  buildThreadParts,
  buildThreadedFeedRows,
  canHideCombinedThreadMarkers,
  combinedThreadText,
  countThreadPostNodes,
  countThreadRows,
  expectedThreadMarkerTotal,
  findThreadNodeByUri,
  getContinuationReply,
  isSelfThreadReply,
  replaceThreadBranch,
  splitTextForThread,
  threadMarkerMatch,
} from "./threads";

const AUTHOR = "did:plc:author";
const OTHER = "did:plc:other";
const BASE = Date.parse("2021-01-01T00:00:00.000Z");

// Minimal post shape: the thread helpers only read uri/cid/author.did/record/
// indexedAt, so a cast keeps fixtures terse (mirrors lib/time.test.ts).
function makePost(opts: {
  uri: string;
  did?: string;
  text?: string;
  offsetMs?: number;
  rootUri?: string;
  parentUri?: string;
  replyCount?: number;
  undated?: boolean;
}): FeedPost {
  const { uri, did = AUTHOR, text = "", offsetMs = 0, rootUri, parentUri, replyCount, undated } = opts;
  const iso = undated ? undefined : new Date(BASE + offsetMs).toISOString();
  return {
    uri,
    cid: `cid-${uri}`,
    author: { did, handle: `${did}.test` },
    record: {
      text,
      ...(iso ? { createdAt: iso } : {}),
      ...(rootUri || parentUri
        ? { reply: { root: rootUri ? { uri: rootUri, cid: `cid-${rootUri}` } : undefined, parent: parentUri ? { uri: parentUri, cid: `cid-${parentUri}` } : undefined } }
        : {}),
    },
    replyCount,
    ...(iso ? { indexedAt: iso } : {}),
  } as FeedPost;
}

function makeItem(post: FeedPost, rootPost?: FeedPost): FeedItem {
  return rootPost ? { post, reply: { root: rootPost } } : { post };
}

function node(post: FeedPost, replies: ThreadNode[] = []): ThreadPostNode {
  return { post, replies };
}

describe("threadMarkerMatch", () => {
  it("parses a trailing n/total counter", () => {
    expect(threadMarkerMatch("hello world 2/5")).toEqual({ index: 2, total: 5 });
  });

  it("accepts a trailing thread emoji", () => {
    expect(threadMarkerMatch("intro 1/3 🧵")).toEqual({ index: 1, total: 3 });
  });

  it("ignores bidi/format control characters around the marker", () => {
    expect(threadMarkerMatch("text ‪3/4‬")).toEqual({ index: 3, total: 4 });
  });

  it("rejects total of 1 (not a thread)", () => {
    expect(threadMarkerMatch("standalone 1/1")).toBeNull();
  });

  it("rejects index greater than total", () => {
    expect(threadMarkerMatch("bogus 5/3")).toBeNull();
  });

  it("only matches at the end of the text", () => {
    expect(threadMarkerMatch("1/5 leading marker then more words")).toBeNull();
  });

  it("returns null when there is no marker", () => {
    expect(threadMarkerMatch("just a normal post")).toBeNull();
  });
});

describe("canHideCombinedThreadMarkers", () => {
  it("hides when every post is sequentially numbered to the total", () => {
    const posts = [makePost({ uri: "a", text: "one 1/3" }), makePost({ uri: "b", text: "two 2/3" }), makePost({ uri: "c", text: "three 3/3" })];
    expect(canHideCombinedThreadMarkers(posts)).toBe(true);
  });

  it("does not hide when a marker total disagrees with the post count", () => {
    const posts = [makePost({ uri: "a", text: "one 1/2" }), makePost({ uri: "b", text: "two 2/2" }), makePost({ uri: "c", text: "three 3/2" })];
    expect(canHideCombinedThreadMarkers(posts)).toBe(false);
  });

  it("does not hide a single post", () => {
    expect(canHideCombinedThreadMarkers([makePost({ uri: "a", text: "solo 1/1" })])).toBe(false);
  });
});

describe("combinedThreadText", () => {
  it("strips the trailing marker when hiding", () => {
    expect(combinedThreadText(makePost({ uri: "a", text: "body text 2/5" }), true)).toBe("body text");
  });

  it("keeps the marker when not hiding", () => {
    expect(combinedThreadText(makePost({ uri: "a", text: "body text 2/5" }), false)).toBe("body text 2/5");
  });
});

describe("splitTextForThread", () => {
  it("returns a single chunk for short text", () => {
    expect(splitTextForThread("short post")).toEqual(["short post"]);
  });

  it("never appends a marker — bsky native threads are pure reply chains", () => {
    const parts = splitTextForThread(`${"a ".repeat(200)}end`, 50);
    expect(parts.join(" ")).not.toMatch(/\d+\/\d+/);
  });

  it("keeps every chunk within the grapheme limit", () => {
    const limit = 40;
    const parts = splitTextForThread(`${"word ".repeat(60)}done.`, limit);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(part)).length).toBeLessThanOrEqual(limit);
    }
  });

  it("prefers paragraph and sentence boundaries", () => {
    const text = "First sentence is here.\n\nSecond paragraph continues with more words to push past the limit.";
    const parts = splitTextForThread(text, 30);
    expect(parts[0]).toBe("First sentence is here.");
  });

  it("counts emoji as single graphemes rather than splitting them", () => {
    const parts = splitTextForThread("👨‍👩‍👧‍👦 ".repeat(10).trim(), 5);
    for (const part of parts) {
      expect(part).not.toContain("�");
    }
    expect(parts.join("").includes("👨‍👩‍👧‍👦")).toBe(true);
  });

  it("does not loop forever on unbreakable runs", () => {
    const parts = splitTextForThread("x".repeat(120), 30);
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.join("")).toBe("x".repeat(120));
  });

  it("keeps a long URL intact in one chunk when it fits the limit", () => {
    // The URL has no internal whitespace, so the splitter must break on the
    // space before it rather than mid-URL, leaving every facet whole. (A token
    // longer than the limit is genuinely unsplittable and not covered here.)
    const url = `https://example.com/${"a".repeat(40)}`;
    const text = `${"word ".repeat(20)}${url} ${"tail ".repeat(20).trim()}`;
    const parts = splitTextForThread(text, 60);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.some((part) => part.includes(url))).toBe(true);
    for (const part of parts) {
      // The URL never appears as a severed prefix/suffix split across chunks.
      const sliced = part.includes(url) ? part.replace(url, "") : part;
      expect(sliced).not.toContain("https://example.com");
    }
  });

  it("splits to satisfy the byte budget even when graphemes are under the limit", () => {
    // Generous grapheme limit (1000) but each 🚀 is 4 UTF-8 bytes, so an 8-byte
    // budget must cap chunks at two rockets regardless of grapheme count — the
    // case that would bite if the grapheme limit were ever raised.
    const parts = splitTextForThread("🚀".repeat(10), 1000, 8);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(8);
    }
    expect(parts.join("")).toBe("🚀".repeat(10));
  });
});

describe("isSelfThreadReply", () => {
  it("is true when the reply author owns the thread root", () => {
    const root = makePost({ uri: "root" });
    const reply = makePost({ uri: "r1", rootUri: "root", parentUri: "root" });
    expect(isSelfThreadReply(makeItem(reply, root), root)).toBe(true);
  });

  it("is false when another account replies into the thread", () => {
    const root = makePost({ uri: "root" });
    const reply = makePost({ uri: "r1", did: OTHER, rootUri: "root", parentUri: "root" });
    expect(isSelfThreadReply(makeItem(reply, root), root)).toBe(false);
  });

  it("is false for a top-level post with no reply root", () => {
    expect(isSelfThreadReply(makeItem(makePost({ uri: "top" })))).toBe(false);
  });
});

describe("getContinuationReply", () => {
  const parent = makePost({ uri: "p", offsetMs: 0 });

  it("picks the earliest same-author reply within the window", () => {
    const early = node(makePost({ uri: "early", parentUri: "p", offsetMs: 1000 }));
    const late = node(makePost({ uri: "late", parentUri: "p", offsetMs: 2000 }));
    expect(getContinuationReply(parent, [late, early])?.post.uri).toBe("early");
  });

  it("ignores replies from a different author", () => {
    const stranger = node(makePost({ uri: "s", did: OTHER, parentUri: "p", offsetMs: 1000 }));
    expect(getContinuationReply(parent, [stranger])).toBeNull();
  });

  it("ignores replies whose parent is some other post", () => {
    const elsewhere = node(makePost({ uri: "e", parentUri: "other", offsetMs: 1000 }));
    expect(getContinuationReply(parent, [elsewhere])).toBeNull();
  });

  it("ignores replies outside the continuation window", () => {
    const tooLate = node(makePost({ uri: "tl", parentUri: "p", offsetMs: CONTINUATION_REPLY_WINDOW_MS + 1 }));
    expect(getContinuationReply(parent, [tooLate])).toBeNull();
  });

  it("does not chain two undated posts as 0ms apart", () => {
    // Both sort to epoch via postSortTime, but the window must use the raw
    // (NaN) parse so unrelated undated posts aren't stitched together.
    const undatedParent = makePost({ uri: "up", undated: true });
    const undatedReply = node(makePost({ uri: "ur", parentUri: "up", undated: true }));
    expect(getContinuationReply(undatedParent, [undatedReply])).toBeNull();
  });
});

describe("buildThreadParts", () => {
  it("returns an empty list for a non-post node", () => {
    expect(buildThreadParts({ $type: "app.bsky.feed.defs#notFoundPost" } as ThreadNode)).toEqual([]);
  });

  it("walks a self-continuation chain and numbers the parts", () => {
    const tree = node(makePost({ uri: "p1", offsetMs: 0 }), [
      node(makePost({ uri: "p2", parentUri: "p1", offsetMs: 1000 }), [node(makePost({ uri: "p3", parentUri: "p2", offsetMs: 2000 }))]),
    ]);
    const parts = buildThreadParts(tree);
    expect(parts.map((part) => part.node.post.uri)).toEqual(["p1", "p2", "p3"]);
    expect(parts.map((part) => part.partNumber)).toEqual([1, 2, 3]);
  });

  it("separates non-continuation replies out of the chain", () => {
    const otherReply = node(makePost({ uri: "x", did: OTHER, parentUri: "p1", offsetMs: 500 }));
    const continuation = node(makePost({ uri: "p2", parentUri: "p1", offsetMs: 1000 }));
    const parts = buildThreadParts(node(makePost({ uri: "p1", offsetMs: 0 }), [otherReply, continuation]));
    expect(parts.map((part) => part.node.post.uri)).toEqual(["p1", "p2"]);
    expect(parts[0].replies.map((reply) => (reply as ThreadPostNode).post.uri)).toEqual(["x"]);
  });
});

describe("expectedThreadMarkerTotal", () => {
  it("reports the marker total when the root says 1/N but fewer parts are loaded", () => {
    const parts = buildThreadParts(node(makePost({ uri: "p1", text: "start 1/4", offsetMs: 0 })));
    expect(expectedThreadMarkerTotal(parts)).toBe(4);
  });

  it("returns null once enough parts are present", () => {
    const parts = buildThreadParts(
      node(makePost({ uri: "p1", text: "start 1/2", offsetMs: 0 }), [node(makePost({ uri: "p2", parentUri: "p1", offsetMs: 1000 }))]),
    );
    expect(expectedThreadMarkerTotal(parts)).toBeNull();
  });
});

describe("buildThreadedFeedRows", () => {
  it("groups a self-thread chain under one row", () => {
    const root = makePost({ uri: "root", offsetMs: 0 });
    const r1 = makePost({ uri: "r1", rootUri: "root", parentUri: "root", offsetMs: 1000 });
    const r2 = makePost({ uri: "r2", rootUri: "root", parentUri: "r1", offsetMs: 2000 });
    const rows = buildThreadedFeedRows([makeItem(root), makeItem(r1, root), makeItem(r2, root)]);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect("replies" in row && row.replies.map((item) => item.post.uri)).toEqual(["r1", "r2"]);
  });

  it("leaves an unrelated post as its own row and never double-consumes", () => {
    const root = makePost({ uri: "root", offsetMs: 0 });
    const r1 = makePost({ uri: "r1", rootUri: "root", parentUri: "root", offsetMs: 1000 });
    const standalone = makePost({ uri: "solo", offsetMs: 5000 });
    const rows = buildThreadedFeedRows([makeItem(root), makeItem(r1, root), makeItem(standalone)]);
    expect(rows).toHaveLength(2);
    const uris = rows.map((row) => ("replies" in row ? row.root.post.uri : row.post.uri));
    expect(uris).toEqual(["root", "solo"]);
  });

  it("does not group a reply that falls outside the continuation window", () => {
    const root = makePost({ uri: "root", offsetMs: 0 });
    const lateReply = makePost({ uri: "late", rootUri: "root", parentUri: "root", offsetMs: CONTINUATION_REPLY_WINDOW_MS + 1 });
    const rows = buildThreadedFeedRows([makeItem(root), makeItem(lateReply, root)]);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => !("replies" in row))).toBe(true);
  });

  it("does not group another account's reply chain", () => {
    const root = makePost({ uri: "root", offsetMs: 0 });
    const reply = makePost({ uri: "r1", did: OTHER, rootUri: "root", parentUri: "root", offsetMs: 1000 });
    const rows = buildThreadedFeedRows([makeItem(root), makeItem(reply, root)]);
    expect(rows).toHaveLength(2);
  });

  it("leaves mid-thread replies ungrouped when the root is absent from the page", () => {
    // Only r1 and r2 are on this page; their shared root isn't. Without the root
    // present the chain can't be reassembled, so each stands alone.
    const r1 = makePost({ uri: "r1", rootUri: "root", parentUri: "root", offsetMs: 1000 });
    const r2 = makePost({ uri: "r2", rootUri: "root", parentUri: "r1", offsetMs: 2000 });
    const rows = buildThreadedFeedRows([makeItem(r1), makeItem(r2)]);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => !("replies" in row))).toBe(true);
  });

  it("stops the chain at a mid-thread author change", () => {
    // root→r1 are the owner; r2 replies to r1 but is a different account, so it
    // must not be folded into the owner's row even though it's in the thread.
    const root = makePost({ uri: "root", offsetMs: 0 });
    const r1 = makePost({ uri: "r1", rootUri: "root", parentUri: "root", offsetMs: 1000 });
    const r2 = makePost({ uri: "r2", did: OTHER, rootUri: "root", parentUri: "r1", offsetMs: 2000 });
    const rows = buildThreadedFeedRows([makeItem(root), makeItem(r1, root), makeItem(r2, root)]);
    const grouped = rows.find((row) => "replies" in row);
    expect(grouped && "replies" in grouped && grouped.replies.map((item) => item.post.uri)).toEqual(["r1"]);
  });
});

describe("thread tree utilities", () => {
  const tree = node(makePost({ uri: "p1" }), [node(makePost({ uri: "p2", parentUri: "p1" }), [node(makePost({ uri: "p3", parentUri: "p2" }))])]);

  it("countThreadPostNodes / countThreadRows count every post node", () => {
    expect(countThreadPostNodes(tree)).toBe(3);
    expect(countThreadRows(tree)).toBe(3);
    expect(countThreadPostNodes(undefined)).toBe(0);
  });

  it("findThreadNodeByUri locates a nested node", () => {
    expect(findThreadNodeByUri(tree, "p3")?.post.uri).toBe("p3");
    expect(findThreadNodeByUri(tree, "missing")).toBeNull();
  });

  it("replaceThreadBranch swaps a subtree by uri without mutating the rest", () => {
    const replacement = node(makePost({ uri: "p2", parentUri: "p1" }), [
      node(makePost({ uri: "p3", parentUri: "p2" })),
      node(makePost({ uri: "p4", parentUri: "p2" })),
    ]);
    const next = replaceThreadBranch(tree, "p2", replacement);
    expect(countThreadPostNodes(next)).toBe(4);
    expect(findThreadNodeByUri(next, "p4")?.post.uri).toBe("p4");
    // Original tree is untouched.
    expect(countThreadPostNodes(tree)).toBe(3);
  });
});
