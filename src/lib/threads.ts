// Pure thread logic extracted from App.tsx so it can be unit-tested in
// isolation (mirrors lib/time.ts). Two concerns live here:
//   1. Compose: splitTextForThread breaks a long draft into native reply-chain
//      parts. No "1/n" markers are written — bsky native threads are pure reply
//      chains (verified against social-app's Composer); markers are read-only.
//   2. Display: reassemble a reply chain back into one cohesive post —
//      getContinuationReply / buildThreadParts walk parent→continuation hops,
//      buildThreadedFeedRows regroups a flat feed, and the marker helpers
//      recognize 1/n counters that *other* clients' users type by hand.

import type { FeedItem, FeedPost, RichTextFacet, ThreadNode, ThreadPostNode } from "../api";
import { postSortTime } from "./time";

// A hand-typed "n/total" thread marker, optionally followed by 🧵 and wrapped in
// bidi/format-control characters, anchored to the end of the text. Other clients'
// users type these by hand; we only recognize them, never write them. Defined
// once so recognition (threadMarkerMatch) and stripping (combinedThreadText)
// can't drift apart. Not declared global, so reusing it across .match/.replace is
// safe (lastIndex is only tracked with the /g flag).
const THREAD_MARKER_RE = /(?:^|\s)[\t\u200e\u200f\u202a-\u202e\u2066-\u2069]*(\d{1,3})\s*\/\s*(\d{1,3})(?:\s*🧵)?[\t\u200e\u200f\u202a-\u202e\u2066-\u2069]*$/u;

// A self-reply counts as a thread continuation purely on structure — same
// author, and it replies directly to the post it continues — with NO time gate.
// This matches bsky's own client, which groups self-threads structurally
// (reply.parent.uri / reply.root.uri + same-author) and never time-bounds them
// (see social-app feed-manip.ts: FeedViewPostsSlice + areSameAuthor). Slow
// self-threads (live-blogs, posts continued days later) combine just like fast
// ones. postSortTime() is still used only to ORDER candidate replies; an
// undated post sorts to epoch but is never excluded on that basis.

export const POST_GRAPHEME_LIMIT = 300;

// An app.bsky.feed.post record's `text` is capped on TWO axes: graphemes (above)
// and raw UTF-8 bytes (the lexicon's maxLength). Today 300 graphemes can't reach
// 3000 bytes, so only the grapheme cap ever bites — but if the grapheme limit is
// raised, a chunk of mostly multi-byte characters (CJK, emoji) could pass the
// grapheme check and still be rejected for bytes. splitTextForThread honors both
// so it stays correct wherever the grapheme limit lands.
export const POST_BYTE_LIMIT = 3000;

export type ThreadPart = {
  node: ThreadPostNode;
  partNumber: number;
  replies: ThreadNode[];
};

export type ThreadedFeedItem = {
  root: FeedItem;
  replies: FeedItem[];
};

export type FeedRow = FeedItem | ThreadedFeedItem;

// Total post nodes in a thread subtree (the root plus every descendant reply
// that is a real post). countThreadRows is a feed-side alias kept for call-site
// readability; both count the same thing.
export function countThreadRows(node?: ThreadNode): number {
  return countThreadPostNodes(node);
}

export function postReplyRootUri(post: FeedPost) {
  return post.record.reply?.root?.uri;
}

export function postReplyParentUri(post: FeedPost) {
  return post.record.reply?.parent?.uri;
}

export function isSelfThreadReply(item: FeedItem, rootPost?: FeedPost) {
  const rootUri = postReplyRootUri(item.post);
  if (!rootUri) {
    return false;
  }
  const rootAuthorDid = rootPost?.author.did || item.reply?.root?.author.did;
  return !!rootAuthorDid && item.post.author.did === rootAuthorDid;
}

export function isThreadedFeedItem(row: FeedRow): row is ThreadedFeedItem {
  return "root" in row && "replies" in row;
}

export function feedRowKey(row: FeedRow) {
  return isThreadedFeedItem(row) ? `thread:${row.root.post.uri}` : row.post.uri;
}

export function feedRowPost(row: FeedRow) {
  return isThreadedFeedItem(row) ? row.root.post : row.post;
}

export function isThreadPostNode(node: ThreadNode): node is ThreadPostNode {
  return "post" in node;
}

export function getContinuationReply(parent: FeedPost, replies: ThreadNode[]) {
  const candidates = replies
    .filter(isThreadPostNode)
    .filter((reply) => reply.post.author.did === parent.author.did && postReplyParentUri(reply.post) === parent.uri)
    // Earliest self-reply wins when the author replied to the same post more
    // than once (a thread fork) — that picks the linear continuation.
    .sort((first, second) => postSortTime(first.post) - postSortTime(second.post));
  return candidates[0] ?? null;
}

export function buildThreadParts(root: ThreadNode): ThreadPart[] {
  if (!isThreadPostNode(root)) {
    return [];
  }

  const parts: ThreadPart[] = [];
  let current: ThreadPostNode | null = root;
  let partNumber = 1;

  while (current) {
    const replies = current.replies ?? [];
    const continuation = getContinuationReply(current.post, replies);
    parts.push({
      node: current,
      partNumber,
      replies: continuation ? replies.filter((reply) => reply !== continuation) : replies,
    });
    current = continuation;
    partNumber += 1;
  }

  return parts;
}

// Walk the anchored node's PARENT chain upward, collecting ancestors that are
// still part of the same self-thread: each step must be authored by the same
// account and reply directly to its parent (the same structural gate
// getContinuationReply applies walking down — no time bound). Returns ancestors
// in ROOT→anchor order (nearest-last), excluding the anchor itself; empty when
// the anchor's parent is not a self-continuation.
//
// This is what lets opening a mid-thread post (e.g. part 3 of 5, reached via
// search/notification/URL) resolve to the true self-thread root instead of
// splitting the chain into a "Reply context" section above the anchor.
export function selfThreadAncestors(anchor: ThreadPostNode): ThreadPostNode[] {
  const ancestors: ThreadPostNode[] = [];
  let child: ThreadPostNode = anchor;
  while (child.parent && isThreadPostNode(child.parent)) {
    const parent = child.parent;
    if (parent.post.author.did !== child.post.author.did) {
      break;
    }
    if (postReplyParentUri(child.post) !== parent.post.uri) {
      break;
    }
    ancestors.unshift(parent);
    child = parent;
  }
  return ancestors;
}

// The node that begins the anchored post's self-thread: the topmost
// self-continuation ancestor, or the anchor itself when it has none.
export function selfThreadRootNode(node: ThreadNode): ThreadNode {
  if (!isThreadPostNode(node)) {
    return node;
  }
  const ancestors = selfThreadAncestors(node);
  return ancestors[0] ?? node;
}

// Build the full ordered self-thread parts spanning ANCESTORS (from the parent
// chain, via selfThreadAncestors) and DESCENDANTS (continuation replies, via
// buildThreadParts), given the AppView node anchored at the opened post.
// Ancestor parent-chain nodes don't carry their sibling replies (the AppView
// only hydrates replies for the anchor subtree), so their `replies` is empty.
// Part numbers are assigned root-first across the whole chain.
export function buildAnchoredThreadParts(node: ThreadNode): ThreadPart[] {
  if (!isThreadPostNode(node)) {
    return [];
  }
  const ancestorParts: ThreadPart[] = selfThreadAncestors(node).map((ancestorNode) => ({
    node: ancestorNode,
    partNumber: 0,
    replies: [],
  }));
  const parts = [...ancestorParts, ...buildThreadParts(node)];
  return parts.map((part, index) => ({ ...part, partNumber: index + 1 }));
}

export function expectedThreadMarkerTotal(parts: ThreadPart[]) {
  const marker = threadMarkerMatch(parts[0]?.node.post.record.text || "");
  return marker?.index === 1 && marker.total > parts.length ? marker.total : null;
}

export function buildThreadedFeedRows(items: FeedItem[]): FeedRow[] {
  const byUri = new Map(items.map((item) => [item.post.uri, item]));
  // Index each author's self-thread replies by the URI of the post they reply
  // to, so a thread is reassembled by walking parent-to-parent (mirroring
  // getContinuationReply / the combined thread view). Grouping is structural —
  // same author replying directly to the prior post — with no time bound, so a
  // self-thread continued hours or days later still reassembles.
  //
  // Reassembly requires the chain ROOT to be present in `items` (it gates the
  // isSelfThreadReply check below). When a feed page contains mid-thread replies
  // but not their root — e.g. across a paging boundary — those replies fall
  // through to standalone rows rather than grouping. That's the accepted limit;
  // the alternative (grouping on root-less replies) risks stitching unrelated
  // posts together.
  const selfRepliesByParent = new Map<string, FeedItem[]>();
  for (const item of items) {
    const rootUri = postReplyRootUri(item.post);
    const parentUri = postReplyParentUri(item.post);
    if (!rootUri || !parentUri) {
      continue;
    }
    const rootItem = byUri.get(rootUri);
    if (!rootItem || !isSelfThreadReply(item, rootItem.post)) {
      continue;
    }
    selfRepliesByParent.set(parentUri, [...(selfRepliesByParent.get(parentUri) ?? []), item]);
  }

  // Memoized by parent URI: continuationOf is a pure function of the parent and
  // the maps above, and every parent is queried at least twice (building
  // continuationUris, then walking each chain), so cache the result to avoid
  // re-running the filter+sort per post on every feed rebuild.
  const continuationCache = new Map<string, FeedItem | null>();
  const continuationOf = (parent: FeedPost): FeedItem | null => {
    const cached = continuationCache.get(parent.uri);
    if (cached !== undefined) {
      return cached;
    }
    const result =
      (selfRepliesByParent.get(parent.uri) ?? [])
        // Same-author-as-the-immediate-parent guard, mirroring
        // getContinuationReply. selfRepliesByParent already filters to the root
        // author, but a hop must also be authored by the post it continues so a
        // mid-chain author change doesn't get stitched into the same row.
        .filter((reply) => reply.post.author.did === parent.author.did)
        .sort((first, second) => postSortTime(first.post) - postSortTime(second.post))[0] ?? null;
    continuationCache.set(parent.uri, result);
    return result;
  };

  // A post that is the chosen continuation of another never starts its own row;
  // rows begin only at chain roots.
  const continuationUris = new Set<string>();
  for (const item of items) {
    const continuation = continuationOf(item.post);
    if (continuation) {
      continuationUris.add(continuation.post.uri);
    }
  }

  const rows: FeedRow[] = [];
  const consumed = new Set<string>();
  for (const item of items) {
    if (continuationUris.has(item.post.uri) || consumed.has(item.post.uri)) {
      continue;
    }

    const replies: FeedItem[] = [];
    let next = continuationOf(item.post);
    while (next && !consumed.has(next.post.uri)) {
      replies.push(next);
      consumed.add(next.post.uri);
      next = continuationOf(next.post);
    }

    rows.push(replies.length ? { root: item, replies } : item);
  }
  return rows;
}

export function replaceThreadBranch(node: ThreadNode, uri: string, replacement: ThreadNode): ThreadNode {
  if (!("post" in node)) {
    return node;
  }

  if (node.post.uri === uri) {
    return replacement;
  }

  return {
    ...node,
    replies: node.replies?.map((reply) => replaceThreadBranch(reply, uri, replacement)),
  };
}

export function findThreadNodeByUri(node: ThreadNode | undefined, uri: string): ThreadPostNode | null {
  if (!node || !("post" in node)) {
    return null;
  }

  if (node.post.uri === uri) {
    return node;
  }

  for (const reply of node.replies ?? []) {
    const found = findThreadNodeByUri(reply, uri);
    if (found) {
      return found;
    }
  }

  return null;
}

export function countThreadPostNodes(node: ThreadNode | undefined): number {
  if (!node || !("post" in node)) {
    return 0;
  }

  return 1 + (node.replies ?? []).reduce((total, reply) => total + countThreadPostNodes(reply), 0);
}

export function threadMarkerMatch(text: string) {
  const match = text.match(THREAD_MARKER_RE);
  if (!match) {
    return null;
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  return total > 1 && index >= 1 && index <= total ? { index, total } : null;
}

export function canHideCombinedThreadMarkers(posts: FeedPost[]) {
  const total = posts.length;
  if (total <= 1) {
    return false;
  }
  return posts.every((post, index) => {
    const marker = threadMarkerMatch(post.record.text || "");
    return marker?.index === index + 1 && marker.total === total;
  });
}

export function combinedThreadText(post: FeedPost, hideThreadMarker: boolean) {
  const text = post.record.text || "";
  return hideThreadMarker
    ? text.replace(THREAD_MARKER_RE, "").trim()
    : text.trim();
}

export type CombinedThreadSegment = {
  text: string;
  facets?: RichTextFacet[];
};

// The display text + facets for one post in a combined/threaded view, with the
// trailing "1/n 🧵" marker stripped when hideThreadMarker is set.
//
// combinedThreadText() alone can't be used when a post has facets: facet
// byteStart/byteEnd offsets index into the RAW record text, so handing the
// trimmed/marker-stripped string to a byte-offset renderer would misalign every
// link/mention/tag. This returns a text+facets pair that stays consistent.
//
// The marker is always TRAILING, so the kept text is a byte-identical prefix of
// the raw text (we only ever trim/cut from the end — never the start when facets
// are present, which would shift offsets). Facets whose byte range overlaps the
// removed trailing region are dropped; the rest are returned unchanged.
export function combinedThreadSegment(post: FeedPost, hideThreadMarker: boolean): CombinedThreadSegment {
  const raw = post.record.text || "";
  const facets = post.record.facets;

  let body = raw;
  if (hideThreadMarker) {
    const match = raw.match(THREAD_MARKER_RE);
    if (match) {
      body = raw.slice(0, match.index ?? raw.length);
    }
  }

  if (!facets?.length) {
    // No facets to keep aligned, so the display text can be fully trimmed.
    return { text: body.trim(), facets: undefined };
  }

  // Facets present: only trim the END so the kept text stays a byte-identical
  // prefix of `raw` and surviving facet offsets remain valid against it.
  const kept = body.replace(/\s+$/u, "");
  const keptByteLength = utf8ByteLength(kept);
  const adjusted = facets.filter((facet) => (facet.index?.byteEnd ?? 0) <= keptByteLength);
  return { text: kept, facets: adjusted };
}

type GraphemeSegmenter = {
  segment(input: string): Iterable<{ segment: string; index: number }>;
};

function graphemeSegments(text: string): Array<{ segment: string; index: number }> {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (locales: string | undefined, options: { granularity: "grapheme" }) => GraphemeSegmenter;
    }
  ).Segmenter;
  if (Segmenter) {
    return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text));
  }
  let index = 0;
  return Array.from(text).map((segment) => {
    const current = { segment, index };
    index += segment.length;
    return current;
  });
}

export function graphemeLength(text: string) {
  return graphemeSegments(text).length;
}

const utf8Encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

export function utf8ByteLength(text: string): number {
  if (utf8Encoder) {
    return utf8Encoder.encode(text).length;
  }
  // Fallback for any runtime without TextEncoder: count UTF-8 bytes by code point.
  let bytes = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

// The code-unit index marking the longest grapheme-aligned prefix of `text` that
// satisfies BOTH the grapheme budget and the UTF-8 byte budget — the hard ceiling
// a single chunk may reach. Never splits inside a grapheme. Always advances by at
// least one grapheme so the caller's loop can't stall (a lone grapheme can't
// exceed a multi-thousand-byte budget in practice, but the guard is cheap).
function hardSplitIndex(text: string, graphemeLimit: number, byteLimit: number) {
  const segments = graphemeSegments(text);
  let bytes = 0;
  for (let i = 0; i < segments.length; i += 1) {
    if (i >= graphemeLimit) {
      return segments[i].index;
    }
    const next = bytes + utf8ByteLength(segments[i].segment);
    if (next > byteLimit) {
      return i === 0 ? segments[0].index + segments[0].segment.length : segments[i].index;
    }
    bytes = next;
  }
  return text.length;
}

function lastMatchEnd(text: string, pattern: RegExp, minimumEnd: number) {
  let fallback = -1;
  let preferred = -1;
  for (const match of text.matchAll(pattern)) {
    const end = (match.index ?? 0) + match[0].length;
    fallback = end;
    if (end >= minimumEnd) {
      preferred = end;
    }
  }
  return preferred >= 0 ? preferred : Math.max(0, fallback);
}

export function splitTextForThread(text: string, limit = POST_GRAPHEME_LIMIT, byteLimit = POST_BYTE_LIMIT) {
  const posts: string[] = [];
  let remaining = text.replace(/\r\n/g, "\n").trim();
  // A non-positive grapheme limit can't make forward progress: hardSplitIndex
  // would return 0, the chunk would be empty, and `remaining` would never
  // shrink — an infinite loop. No real call site passes < 1 (default is
  // POST_GRAPHEME_LIMIT), but guard defensively and emit the text as one post.
  if (limit < 1) {
    return remaining ? [remaining] : [];
  }
  while (remaining && (graphemeLength(remaining) > limit || utf8ByteLength(remaining) > byteLimit)) {
    const hardEnd = hardSplitIndex(remaining, limit, byteLimit);
    const windowText = remaining.slice(0, hardEnd);
    const minimumEnd = Math.floor(hardEnd * 0.66);
    const splitAt =
      lastMatchEnd(windowText, /\n\s*\n/g, minimumEnd) ||
      lastMatchEnd(windowText, /[.!?…]["')\]]?\s+/g, minimumEnd) ||
      lastMatchEnd(windowText, /[,;:]\s+/g, minimumEnd) ||
      lastMatchEnd(windowText, /\s+/g, minimumEnd) ||
      hardEnd;
    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) {
      posts.push(chunk);
    }
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) {
    posts.push(remaining);
  }
  return posts;
}
