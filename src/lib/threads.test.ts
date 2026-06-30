// Behavioral tests for the thread logic extracted from App.tsx. These exercise
// the real shipped helpers against the cases that actually bite: native
// reply-chain reassembly (no "1/n" markers written — bsky native threads are
// pure reply chains), the per-hop continuation time window, grapheme-aware
// splitting, and the read-only marker recognition for other clients' threads.

import { describe, expect, it } from "vitest";
import type { FeedItem, FeedPost, RichTextFacet, ThreadNode, ThreadPostNode } from "../api";
import {
  buildAnchoredThreadParts,
  buildThreadParts,
  buildThreadedFeedRows,
  canHideCombinedThreadMarkers,
  combinedThreadSegment,
  combinedThreadText,
  countThreadPostNodes,
  countThreadRows,
  expectedThreadMarkerTotal,
  findThreadNodeByUri,
  getContinuationReply,
  isSelfThreadReply,
  replaceThreadBranch,
  selfThreadAncestors,
  selfThreadRootNode,
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

function nodeWithParent(post: FeedPost, parent?: ThreadPostNode, replies: ThreadNode[] = []): ThreadPostNode {
  return { post, parent, replies };
}

function withFacets(post: FeedPost, facets: RichTextFacet[]): FeedPost {
  return { ...post, record: { ...post.record, facets } } as FeedPost;
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

describe("combinedThreadSegment", () => {
  it("strips the trailing marker and fully trims text with no facets", () => {
    const segment = combinedThreadSegment(makePost({ uri: "a", text: "  body text 2/5" }), true);
    expect(segment).toEqual({ text: "body text", facets: undefined });
  });

  it("keeps the marker (and facets) when not hiding", () => {
    const facets: RichTextFacet[] = [{ index: { byteStart: 3, byteEnd: 15 }, features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://a.bc" }] }];
    const post = withFacets(makePost({ uri: "a", text: "go https://a.bc 1/3" }), facets);
    expect(combinedThreadSegment(post, false)).toEqual({ text: "go https://a.bc 1/3", facets });
  });

  it("strips the marker while keeping a non-overlapping facet aligned to the kept prefix", () => {
    // "go https://a.bc" is 15 bytes; the link facet ends at byte 15, the marker
    // " 1/3" follows — so the link survives unchanged against the kept text.
    const facets: RichTextFacet[] = [{ index: { byteStart: 3, byteEnd: 15 }, features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://a.bc" }] }];
    const post = withFacets(makePost({ uri: "a", text: "go https://a.bc 1/3" }), facets);
    const segment = combinedThreadSegment(post, true);
    expect(segment.text).toBe("go https://a.bc");
    expect(segment.facets).toEqual(facets);
  });

  it("drops a facet whose byte range overlaps the removed trailing marker", () => {
    // A facet spanning past the marker boundary can't survive the cut, so it is
    // discarded rather than left pointing into bytes that no longer exist.
    const facets: RichTextFacet[] = [{ index: { byteStart: 0, byteEnd: 8 }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: "x" }] }];
    const post = withFacets(makePost({ uri: "a", text: "link 2/5" }), facets);
    const segment = combinedThreadSegment(post, true);
    expect(segment.text).toBe("link");
    expect(segment.facets).toEqual([]);
  });

  it("leaves a facet-bearing post untouched when there is no marker", () => {
    const facets: RichTextFacet[] = [{ index: { byteStart: 0, byteEnd: 5 }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: "hello" }] }];
    const post = withFacets(makePost({ uri: "a", text: "hello world" }), facets);
    const segment = combinedThreadSegment(post, true);
    expect(segment.text).toBe("hello world");
    expect(segment.facets).toEqual(facets);
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

  it("does not loop forever when the grapheme limit is non-positive", () => {
    // A limit of 0 (or negative) makes hardSplitIndex return 0, which would spin
    // the chunk loop forever; the guard bails to a single trimmed post.
    expect(splitTextForThread("hello world", 0)).toEqual(["hello world"]);
    expect(splitTextForThread("  hello world  ", -5)).toEqual(["hello world"]);
    expect(splitTextForThread("   ", 0)).toEqual([]);
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

  it("picks the earliest same-author reply", () => {
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

  it("chains a far-apart self-reply (no time gate, matching bsky)", () => {
    // A self-reply continued days later is still structurally a continuation.
    const muchLater = node(makePost({ uri: "later", parentUri: "p", offsetMs: 5 * 24 * 60 * 60 * 1000 }));
    expect(getContinuationReply(parent, [muchLater])?.post.uri).toBe("later");
  });

  it("chains two undated posts when the reply structure matches", () => {
    // Both sort to epoch, but the grouping is structural — same author replying
    // directly to the parent — so undated self-replies still chain.
    const undatedParent = makePost({ uri: "up", undated: true });
    const undatedReply = node(makePost({ uri: "ur", parentUri: "up", undated: true }));
    expect(getContinuationReply(undatedParent, [undatedReply])?.post.uri).toBe("ur");
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

describe("selfThreadAncestors / buildAnchoredThreadParts", () => {
  // A 3-part self-thread (p1→p2→p3) where the AppView node is anchored at the
  // DEEPEST post (p3), with its ancestors hanging off `.parent` and no replies
  // populated on the parent-chain nodes — exactly what getPostThread returns
  // when you open part 3 of 5 directly.
  function midThreadAnchor() {
    const rNode = nodeWithParent(makePost({ uri: "p1", offsetMs: 0 }));
    const aNode = nodeWithParent(makePost({ uri: "p2", parentUri: "p1", offsetMs: 1000 }), rNode);
    return nodeWithParent(makePost({ uri: "p3", parentUri: "p2", offsetMs: 2000 }), aNode);
  }

  it("walks the parent chain back to the true self-thread root", () => {
    expect(selfThreadAncestors(midThreadAnchor()).map((n) => n.post.uri)).toEqual(["p1", "p2"]);
  });

  it("re-roots a mid-thread anchor into one ordered, renumbered chain", () => {
    const parts = buildAnchoredThreadParts(midThreadAnchor());
    expect(parts.map((part) => part.node.post.uri)).toEqual(["p1", "p2", "p3"]);
    expect(parts.map((part) => part.partNumber)).toEqual([1, 2, 3]);
  });

  it("selfThreadRootNode reports the true root, not the anchor", () => {
    expect((selfThreadRootNode(midThreadAnchor()) as ThreadPostNode).post.uri).toBe("p1");
  });

  it("does not walk past a different-author parent", () => {
    const stranger = nodeWithParent(makePost({ uri: "x", did: OTHER, offsetMs: 0 }));
    const anchor = nodeWithParent(makePost({ uri: "c", parentUri: "x", offsetMs: 1000 }), stranger);
    expect(selfThreadAncestors(anchor)).toEqual([]);
    expect(buildAnchoredThreadParts(anchor).map((part) => part.node.post.uri)).toEqual(["c"]);
  });

  it("walks past a far-apart same-author parent (no time gate)", () => {
    const rNode = nodeWithParent(makePost({ uri: "p1", offsetMs: 0 }));
    const anchor = nodeWithParent(makePost({ uri: "p2", parentUri: "p1", offsetMs: 5 * 24 * 60 * 60 * 1000 }), rNode);
    expect(selfThreadAncestors(anchor).map((n) => n.post.uri)).toEqual(["p1"]);
  });

  it("appends descendant continuation parts after the re-rooted ancestors", () => {
    // Anchored at p2 with a downward continuation p3 in its replies; the parent
    // p1 is above. The whole chain should resolve in order.
    const rNode = nodeWithParent(makePost({ uri: "p1", offsetMs: 0 }));
    const anchor = nodeWithParent(makePost({ uri: "p2", parentUri: "p1", offsetMs: 1000 }), rNode, [
      node(makePost({ uri: "p3", parentUri: "p2", offsetMs: 2000 })),
    ]);
    expect(buildAnchoredThreadParts(anchor).map((part) => part.node.post.uri)).toEqual(["p1", "p2", "p3"]);
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

  it("recovers the total from a mid-chain anchor via buildAnchoredThreadParts", () => {
    // Anchor at part 3 of a 5-part thread (root above via .parent). buildThreadParts
    // alone starts at the anchor (marker 3/5, index !== 1) and yields null — the bug
    // that left long mid-chain threads unhydrated. Walking up to the root recovers 5.
    const rNode = nodeWithParent(makePost({ uri: "p1", text: "start 1/5", offsetMs: 0 }));
    const aNode = nodeWithParent(makePost({ uri: "p2", text: "more 2/5", parentUri: "p1", offsetMs: 1000 }), rNode);
    const anchor = nodeWithParent(makePost({ uri: "p3", text: "mid 3/5", parentUri: "p2", offsetMs: 2000 }), aNode);
    expect(expectedThreadMarkerTotal(buildThreadParts(anchor))).toBeNull();
    expect(expectedThreadMarkerTotal(buildAnchoredThreadParts(anchor))).toBe(5);
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

  it("groups a far-apart self-reply (no time gate, matching bsky)", () => {
    const root = makePost({ uri: "root", offsetMs: 0 });
    const lateReply = makePost({ uri: "late", rootUri: "root", parentUri: "root", offsetMs: 5 * 24 * 60 * 60 * 1000 });
    const rows = buildThreadedFeedRows([makeItem(root), makeItem(lateReply, root)]);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect("replies" in row && row.replies.map((item) => item.post.uri)).toEqual(["late"]);
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
