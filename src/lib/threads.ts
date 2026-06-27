// Pure thread logic extracted from App.tsx so it can be unit-tested in
// isolation (mirrors lib/time.ts). Two concerns live here:
//   1. Compose: splitTextForThread breaks a long draft into native reply-chain
//      parts. No "1/n" markers are written — bsky native threads are pure reply
//      chains (verified against social-app's Composer); markers are read-only.
//   2. Display: reassemble a reply chain back into one cohesive post —
//      getContinuationReply / buildThreadParts walk parent→continuation hops,
//      buildThreadedFeedRows regroups a flat feed, and the marker helpers
//      recognize 1/n counters that *other* clients' users type by hand.

import type { FeedItem, FeedPost, ThreadNode, ThreadPostNode } from "../api";
import { parseTimestamp, postSortAt, postSortTime } from "./time";

// A hand-typed "n/total" thread marker, optionally followed by 🧵 and wrapped in
// bidi/format-control characters, anchored to the end of the text. Other clients'
// users type these by hand; we only recognize them, never write them. Defined
// once so recognition (threadMarkerMatch) and stripping (combinedThreadText)
// can't drift apart. Not declared global, so reusing it across .match/.replace is
// safe (lastIndex is only tracked with the /g flag).
const THREAD_MARKER_RE = /(?:^|\s)[\t\u200e\u200f\u202a-\u202e\u2066-\u2069]*(\d{1,3})\s*\/\s*(\d{1,3})(?:\s*🧵)?[\t\u200e\u200f\u202a-\u202e\u2066-\u2069]*$/u;

// The raw parsed sort timestamp, used only for the continuation-window math.
// postSortTime() normalizes an undated post to epoch (0) so feed sorting stays
// stable, but the window must NOT treat two undated posts as 0ms apart (that
// would chain unrelated posts); here an undated post yields NaN and fails the
// Number.isFinite guards at the call sites.
function windowTime(post: FeedPost): number {
  return parseTimestamp(postSortAt(post));
}

// A self-reply only counts as a thread continuation if it lands within this
// window of its own parent. Each hop is measured against its parent (not the
// root), so a thread that runs longer than the window still chains as long as
// each individual step is close together.
export const CONTINUATION_REPLY_WINDOW_MS = 10 * 60 * 1000;

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
  const parentTime = windowTime(parent);
  const candidates = replies
    .filter(isThreadPostNode)
    .filter((reply) => {
      if (reply.post.author.did !== parent.author.did || postReplyParentUri(reply.post) !== parent.uri) {
        return false;
      }
      const replyTime = windowTime(reply.post);
      return Number.isFinite(parentTime) && Number.isFinite(replyTime) && replyTime - parentTime >= 0 && replyTime - parentTime <= CONTINUATION_REPLY_WINDOW_MS;
    })
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

export function expectedThreadMarkerTotal(parts: ThreadPart[]) {
  const marker = threadMarkerMatch(parts[0]?.node.post.record.text || "");
  return marker?.index === 1 && marker.total > parts.length ? marker.total : null;
}

export function buildThreadedFeedRows(items: FeedItem[]): FeedRow[] {
  const byUri = new Map(items.map((item) => [item.post.uri, item]));
  // Index each author's self-thread replies by the URI of the post they reply
  // to, so a thread is reassembled by walking parent-to-parent — each hop within
  // CONTINUATION_REPLY_WINDOW_MS of its own parent (mirroring
  // getContinuationReply / the combined thread view). Measuring every part from
  // the root instead would drop later parts of a thread that runs longer than
  // the window even though each individual hop is close together.
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
    const parentTime = windowTime(parent);
    const result = !Number.isFinite(parentTime)
      ? null
      : (selfRepliesByParent.get(parent.uri) ?? [])
          // Same-author-as-the-immediate-parent guard, mirroring
          // getContinuationReply. selfRepliesByParent already filters to the root
          // author, but a hop must also be authored by the post it continues so a
          // mid-chain author change doesn't get stitched into the same row.
          .filter((reply) => reply.post.author.did === parent.author.did)
          .filter((reply) => {
            const replyTime = windowTime(reply.post);
            return Number.isFinite(replyTime) && replyTime - parentTime >= 0 && replyTime - parentTime <= CONTINUATION_REPLY_WINDOW_MS;
          })
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
