// Regression harness for the pure rich-text facet segmentation in
// src/richtext.ts. Unlike the static-source verifiers, this actually executes
// segmentRichText against the byte-offset edge cases the Bluesky rich-text docs
// call out: Unicode/emoji byte offsets, links, mentions, hashtags, overlapping
// facets (later one discarded), trailing punctuation, multi-feature ranges
// (supported feature preferred over unknown $type), and out-of-bounds byteEnd.
//
// Reference: https://docs.bsky.app/docs/advanced-guides/post-richtext
//
// The helper is TypeScript with a type-only import of ./api and a runtime import
// of ./lib/url, so we bundle it via esbuild (a Vite dependency) and import the
// result. Bundling inlines the real ./lib/url helper and drops the type-only
// ./api import, keeping the test exercising the real shipped module graph rather
// than a re-implementation.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const result = await build({
  entryPoints: [resolve(here, "../src/richtext.ts")],
  bundle: true,
  format: "esm",
  write: false,
  platform: "neutral",
});
const code = result.outputFiles[0].text;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const { segmentRichText } = await import(moduleUrl);

const failures = [];

// Byte offsets are over the UTF-8 encoding of the text. These helpers build
// facet index ranges the same way a real producer would.
const enc = new TextEncoder();
function byteLen(text) {
  return enc.encode(text).length;
}
// Range for `needle` within `text` (first occurrence), measured in bytes.
function range(text, needle) {
  const before = text.slice(0, text.indexOf(needle));
  const byteStart = byteLen(before);
  return { byteStart, byteEnd: byteStart + byteLen(needle) };
}
function link(uri) {
  return { $type: "app.bsky.richtext.facet#link", uri };
}
function mention(did) {
  return { $type: "app.bsky.richtext.facet#mention", did };
}
function tag(value) {
  return { $type: "app.bsky.richtext.facet#tag", tag: value };
}
function facet(text, needle, ...features) {
  return { index: range(text, needle), features };
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures.push(`${label}\n      expected ${e}\n      got      ${a}`);
  }
}

// 1. Empty text -> no segments.
eq(segmentRichText("", undefined), [], "empty text yields no segments");

// 2. No facets -> single text segment carrying the whole string.
eq(segmentRichText("hello world", undefined), [{ kind: "text", text: "hello world" }], "plain text is a single text segment");
eq(segmentRichText("hello world", []), [{ kind: "text", text: "hello world" }], "empty facet list is a single text segment");

// 3. A link facet splits text/link/text around the matched bytes.
{
  const text = "see example here";
  eq(
    segmentRichText(text, [facet(text, "example", link("https://example.com"))]),
    [
      { kind: "text", text: "see " },
      { kind: "link", text: "example", uri: "https://example.com/" },
      { kind: "text", text: " here" },
    ],
    "link facet splits surrounding text",
  );
}

// 4. A non-http link uri downgrades to plain text (no clickable anchor).
{
  const text = "open app";
  eq(
    segmentRichText(text, [facet(text, "app", link("javascript:alert(1)"))]),
    [{ kind: "text", text: "open app" }],
    "unsafe link uri downgrades to text (and merges with neighbors)",
  );
}

// 5. Mention facet carries the did; text keeps the leading @.
{
  const text = "hi @alice.test ok";
  eq(
    segmentRichText(text, [facet(text, "@alice.test", mention("did:plc:alice"))]),
    [
      { kind: "text", text: "hi " },
      { kind: "mention", text: "@alice.test", did: "did:plc:alice" },
      { kind: "text", text: " ok" },
    ],
    "mention facet carries did",
  );
}

// 6. Hashtag facet carries the tag value without the leading #.
{
  const text = "a #BlueSky b";
  eq(
    segmentRichText(text, [facet(text, "#BlueSky", tag("BlueSky"))]),
    [
      { kind: "text", text: "a " },
      { kind: "tag", text: "#BlueSky", tag: "BlueSky" },
      { kind: "text", text: " b" },
    ],
    "hashtag facet carries tag value",
  );
}

// 7. Unicode/emoji byte offsets: a facet after multi-byte characters must use
//    UTF-8 byte positions, not JS string indices.
{
  const text = "café 🍰 #cake!";
  // "café 🍰 " then "#cake" — café has a 2-byte é, the cake emoji is 4 bytes.
  eq(
    segmentRichText(text, [facet(text, "#cake", tag("cake"))]),
    [
      { kind: "text", text: "café 🍰 " },
      { kind: "tag", text: "#cake", tag: "cake" },
      { kind: "text", text: "!" },
    ],
    "byte offsets respect multi-byte UTF-8 (accent + emoji)",
  );
}

// 8. Trailing punctuation stays outside the facet as a following text segment.
{
  const text = "link to https://example.com.";
  const r = range(text, "https://example.com");
  eq(
    segmentRichText(text, [{ index: r, features: [link("https://example.com")] }]),
    [
      { kind: "text", text: "link to " },
      { kind: "link", text: "https://example.com", uri: "https://example.com/" },
      { kind: "text", text: "." },
    ],
    "trailing punctuation is not absorbed into the link",
  );
}

// 9. Overlapping facets: the later (by byteStart) overlapping facet is discarded.
{
  const text = "overlap";
  const facets = [
    { index: { byteStart: 0, byteEnd: 4 }, features: [tag("first")] },
    { index: { byteStart: 2, byteEnd: 7 }, features: [tag("second")] }, // overlaps -> dropped
  ];
  eq(
    segmentRichText(text, facets),
    [
      { kind: "tag", text: "over", tag: "first" },
      { kind: "text", text: "lap" },
    ],
    "overlapping later facet is discarded",
  );
}

// 10. Out-of-bounds byteEnd is discarded, leaving plain text.
{
  const text = "short";
  const facets = [{ index: { byteStart: 0, byteEnd: 999 }, features: [link("https://example.com")] }];
  eq(segmentRichText(text, facets), [{ kind: "text", text: "short" }], "out-of-bounds byteEnd facet is discarded");
}

// 11. Zero/negative-length ranges (byteStart >= byteEnd) are discarded.
{
  const text = "noop";
  const facets = [{ index: { byteStart: 2, byteEnd: 2 }, features: [tag("x")] }];
  eq(segmentRichText(text, facets), [{ kind: "text", text: "noop" }], "zero-length facet range is discarded");
}

// 12. Multi-feature range: a supported feature is preferred over an unknown
//     $type sharing the same range (the link must win, not be dropped).
{
  const text = "click here now";
  const r = range(text, "here");
  const facets = [
    {
      index: r,
      features: [
        { $type: "app.example.unknown#thing", uri: "https://example.com" },
        link("https://example.com"),
      ],
    },
  ];
  eq(
    segmentRichText(text, facets),
    [
      { kind: "text", text: "click " },
      { kind: "link", text: "here", uri: "https://example.com/" },
      { kind: "text", text: " now" },
    ],
    "supported feature preferred over unknown $type on the same range",
  );
}

// 13. A range with only an unknown feature falls back to plain text.
{
  const text = "mystery box";
  const facets = [facet(text, "box", { $type: "app.example.unknown#thing" })];
  eq(segmentRichText(text, facets), [{ kind: "text", text: "mystery box" }], "unknown-only feature falls back to text");
}

// 14. Adjacent facets with no gap produce no empty text segment between them.
{
  const text = "@a#b";
  const facets = [
    { index: { byteStart: 0, byteEnd: 2 }, features: [mention("did:plc:a")] },
    { index: { byteStart: 2, byteEnd: 4 }, features: [tag("b")] },
  ];
  eq(
    segmentRichText(text, facets),
    [
      { kind: "mention", text: "@a", did: "did:plc:a" },
      { kind: "tag", text: "#b", tag: "b" },
    ],
    "adjacent facets produce no empty text segment",
  );
}

if (failures.length > 0) {
  throw new Error(`Rich-text segmentation verification failed:\n  - ${failures.join("\n  - ")}`);
}

console.log("Rich-text segmentation verification passed: 14 cases (Unicode/emoji byte offsets, links, mentions, tags, overlaps, multi-feature, out-of-bounds).");
