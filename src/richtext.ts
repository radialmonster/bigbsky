import type { RichTextFacet } from "./api";
import { safeHttpUrl } from "./lib/url";

// Pure, framework-free segmentation of Bluesky rich-text facets.
//
// This module owns the byte-range / facet-selection logic that used to live
// inline in `renderRichText` (src/App.tsx). Keeping it pure (no React, no DOM)
// makes the docs' regression cases — Unicode/emoji byte offsets, overlapping
// facets, multi-feature ranges, out-of-bounds byteEnd — testable in plain Node
// (see scripts/verify-richtext.mjs).
//
// Reference: https://docs.bsky.app/docs/advanced-guides/post-richtext

export type RichTextSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; uri: string }
  | { kind: "mention"; text: string; did: string }
  | { kind: "tag"; text: string; tag: string };

const LINK_TYPE = "app.bsky.richtext.facet#link";
const MENTION_TYPE = "app.bsky.richtext.facet#mention";
const TAG_TYPE = "app.bsky.richtext.facet#tag";

export function segmentRichText(
  text: string,
  facets: RichTextFacet[] | undefined,
): RichTextSegment[] {
  if (!text) {
    return [];
  }

  const usable = (facets ?? []).filter(
    (facet) =>
      typeof facet.index?.byteStart === "number" &&
      typeof facet.index?.byteEnd === "number" &&
      Array.isArray(facet.features) &&
      facet.features.length > 0,
  );
  if (usable.length === 0) {
    return [{ kind: "text", text }];
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(text);
  const sorted = [...usable].sort(
    (a, b) => (a.index!.byteStart ?? 0) - (b.index!.byteStart ?? 0),
  );
  const segments: RichTextSegment[] = [];
  let cursor = 0;

  const pushText = (value: string) => {
    if (!value) {
      return;
    }
    const last = segments[segments.length - 1];
    if (last && last.kind === "text") {
      last.text += value;
    } else {
      segments.push({ kind: "text", text: value });
    }
  };

  for (const facet of sorted) {
    const start = facet.index!.byteStart ?? 0;
    const end = facet.index!.byteEnd ?? 0;
    // Discard overlapping (start before cursor), zero/negative, and
    // out-of-bounds ranges. Inclusive start, exclusive end.
    if (start < cursor || start >= end || end > bytes.length) {
      continue;
    }
    if (start > cursor) {
      pushText(decoder.decode(bytes.slice(cursor, start)));
    }
    const segment = decoder.decode(bytes.slice(start, end));

    // Docs allow multiple features on one range; prefer the first feature this
    // renderer actually supports (link/mention/tag) rather than blindly taking
    // the first typed feature, which could be an unknown $type that drops a
    // usable link/mention/tag sharing the same range.
    const features = facet.features ?? [];
    const feature =
      features.find(
        (item) =>
          (item.$type === LINK_TYPE && item.uri) ||
          (item.$type === MENTION_TYPE && item.did) ||
          (item.$type === TAG_TYPE && (item.tag || segment)),
      ) ?? features.find((item) => typeof item.$type === "string");
    const type = feature?.$type;

    if (type === LINK_TYPE && feature?.uri) {
      const uri = safeHttpUrl(feature.uri);
      if (uri) {
        segments.push({ kind: "link", text: segment, uri });
      } else {
        pushText(segment);
      }
    } else if (type === MENTION_TYPE && feature?.did) {
      segments.push({ kind: "mention", text: segment, did: feature.did });
    } else if (type === TAG_TYPE && (feature?.tag || segment)) {
      const tag = feature?.tag || segment.replace(/^#/, "");
      segments.push({ kind: "tag", text: segment, tag });
    } else {
      pushText(segment);
    }
    cursor = end;
  }

  if (cursor < bytes.length) {
    pushText(decoder.decode(bytes.slice(cursor)));
  }

  return segments;
}
