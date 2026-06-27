import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");
const css = readFileSync("src/styles.css", "utf8");
const failures = [];

function requirePattern(source, pattern, label) {
  if (!pattern.test(source)) {
    failures.push(label);
  }
}

function forbidPattern(source, pattern, label) {
  if (pattern.test(source)) {
    failures.push(label);
  }
}

requirePattern(app, /function readColumnPreferences\(\): ColumnVisibility/, "reader should resolve optional column visibility (with legacy width migration)");
requirePattern(app, /const \[columns, setColumns\][\s\S]*readColumnPreferences\(\)/, "column visibility should be read before first paint");
requirePattern(app, /columns\.feeds \? "" : " feeds-hidden"[\s\S]*columns\.right \? "" : " right-hidden"/, "the shell should apply feeds-hidden / right-hidden state classes from column visibility");
requirePattern(app, /safeLocalStorageSet\(columnsStorageKey, JSON\.stringify\(next\)\)/, "column visibility should persist locally");

requirePattern(app, /function VirtualPostList\([\s\S]*defaultRowHeight = density === "compact" \? 112 : density === "media" \? 360 : 260/s, "virtual rows should use density-aware estimated heights");
requirePattern(app, /const overscanPixels = defaultRowHeight \* 3/, "virtual list should overscan a bounded row window");
requirePattern(app, /function VirtualPostList\([\s\S]*const findRowIndex = useCallback\([\s\S]*while \(low <= high\)/s, "virtual list should locate rows by offset without scanning all rows on scroll");
requirePattern(app, /data-total-rows=\{items\.length\}[\s\S]*data-rendered-rows=\{visibleItems\.length\}/s, "virtual list should expose loaded and rendered row counts");
requirePattern(app, /topSpacerHeight > 0[\s\S]*bottomSpacerHeight > 0/s, "virtual list should use top and bottom spacers instead of mounting all rows");
requirePattern(app, /rowTop \+ previousHeight <= container\.scrollTop[\s\S]*container\.scrollTop \+= height - previousHeight/s, "measured row updates should compensate scroll position above the viewport");
requirePattern(css, /\.virtual-list \{[\s\S]*overflow-anchor: none;/s, "virtual list should disable native scroll anchoring so measured row compensation is not doubled");
requirePattern(app, /onRenderedRowsChange\(visibleItems\.length\)/, "development inspector should receive rendered row counts");

requirePattern(app, /image\.aspectRatio\?\.width && image\.aspectRatio\?\.height[\s\S]*aspectRatio: `\$\{image\.aspectRatio\.width\} \/ \$\{image\.aspectRatio\.height\}`/s, "image embeds should use Bluesky aspect-ratio metadata");
requirePattern(app, /video\.aspectRatio\?\.width && video\.aspectRatio\?\.height[\s\S]*`\$\{video\.aspectRatio\.width\} \/ \$\{video\.aspectRatio\.height\}`/s, "video embeds should use Bluesky aspect-ratio metadata");
requirePattern(app, /const videoFrameStyle = aspectRatio[\s\S]*"--video-aspect": aspectRatio/s, "video embeds should put aspect ratio on the stable card frame");
requirePattern(css, /\.post-card \{[\s\S]*contain: content;/s, "post cards should use containment to limit repaint scope");
requirePattern(css, /\.post-card\.has-media,[\s\S]*--post-embed-min: 220px;/s, "rich post cards should reserve stable embed space");
requirePattern(css, /\.link-card \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/s, "link cards should have stable desktop grid sizing");
requirePattern(css, /\.media \.post-card\.has-media \.image-grid\.count-1 img,[\s\S]*min-height: min\(46vh, 420px\);/s, "media density should reserve larger media height");
requirePattern(css, /\.video-card \{[\s\S]*width: 100%;[\s\S]*aspect-ratio: var\(--video-aspect, 16 \/ 9\);[\s\S]*max-height: calc\(100vh - 140px\);/s, "video card should reserve the playback frame before media metadata loads and use the image viewport cap");
requirePattern(css, /\.video-card video,[\s\S]*\.video-card img,[\s\S]*\.video-placeholder \{[\s\S]*height: 100%;/s, "video media elements should fill the stable card frame");

requirePattern(css, /\.app-shell:where\(\.feeds-hidden\) \{[\s\S]*grid-template-columns: 76px minmax\(0, 1fr\) 320px;/s, "hiding the feeds column should drop its track and let content absorb the space");
requirePattern(css, /\.app-shell:where\(\.right-hidden\) \{[\s\S]*grid-template-columns: 76px 288px minmax\(0, 1fr\);/s, "hiding the right column should drop its track and let content absorb the space");
requirePattern(css, /\.app-shell:where\(\.feeds-hidden\):where\(\.right-hidden\) \{[\s\S]*grid-template-columns: 76px minmax\(0, 1fr\);/s, "hiding both columns should leave only the icon rail and content");
requirePattern(css, /\.feeds-hidden \.feed-map \{[\s\S]*display: none;/s, "feeds-hidden should remove the feeds column element from the grid");
requirePattern(css, /\.right-hidden \.right-rail \{[\s\S]*display: none;/s, "right-hidden should remove the right column element from the grid");
requirePattern(css, /@media \(max-width: 1323px\) \{[\s\S]*\.right-rail \{[\s\S]*display: none;/s, "below the 4-column minimum the right column should auto-hide so it cannot clip off-screen");
requirePattern(css, /@media \(max-width: 1003px\) \{[\s\S]*\.feed-map \{[\s\S]*display: none;/s, "below the 3-column minimum the feeds column should auto-hide too");
// The reader is widened fluidly by a single `1fr` content column, not by
// per-screen-size grid overrides. The content column must always be the
// one that absorbs remaining width (the widest), with fixed narrow rails.
requirePattern(css, /\.app-shell \{[\s\S]*grid-template-columns: 76px 288px minmax\(640px, 1fr\) 320px;/s, "content column should fluidly absorb remaining width via 1fr as the widest column");
forbidPattern(css, /minmax\(980px, 1fr\)/s, "do not re-add the per-screen-size content-column override; widen it fluidly with 1fr");
forbidPattern(css, /\.app-shell\.width-(wide|focus)/s, "do not re-add per-screen-size width-mode grid overrides; the base width-mode grids already scale via 1fr");
forbidPattern(css, /min-width: 2560px/s, "do not add ultrawide-specific breakpoints; the 1fr content column already scales");
// Mobile single column must use minmax(0, 1fr) so wide post content cannot
// hold the column open and clip the right edge.
requirePattern(css, /@media \(max-width: 720px\) \{[\s\S]*\.app-shell \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/s, "mobile single column should be minmax(0, 1fr) so content cannot force horizontal overflow");
// Post content fills the wide content column (no narrow max-width caps on the
// prose/header/actions): the content column should be the widest and its
// content should use that width.
forbidPattern(css, /\.post-text \{[^}]*max-width/s, "post prose must not be capped narrower than the wide content column");
forbidPattern(css, /\.post-card \.post-actions \{[^}]*max-width: 720px/s, "post text-flow elements must not be capped narrower than the wide content column");
requirePattern(css, /@media \(min-width: 1900px\) \{[\s\S]*\.timeline\.compact \.post-card:is\(\.has-link, \.has-quote, \.has-media\):not\(\.media-hidden\) \{[\s\S]*display: grid;[\s\S]*grid-template-columns: minmax\(280px, 0\.92fr\) minmax\(360px, 1\.08fr\);/s, "very wide compact rich cards should become two-zone cards when media is visible");
requirePattern(css, /\.compact \.post-card\.text-only,[\s\S]*\.compact \.post-card\.media-hidden \{[\s\S]*display: grid;/s, "compact media-hidden cards should use dense desktop rows");
requirePattern(css, /@media \(max-width: 720px\) \{[\s\S]*\.compact \.post-card\.text-only,[\s\S]*\.compact \.post-card\.media-hidden \{[\s\S]*display: block;/s, "wide-only compact layout should collapse on mobile");

forbidPattern(css, /\.timeline\s*\{[^}]*max-width:\s*6\d\dpx/s, "timeline should not be capped to a narrow mobile column");
forbidPattern(css, /\.post-card\s*\{[^}]*max-width:\s*6\d\dpx/s, "post cards should not be capped to a narrow mobile column");

if (failures.length > 0) {
  throw new Error(`Layout behavior verification failed: ${failures.join("; ")}`);
}

console.log(
  "Layout behavior verification passed: width modes, very-wide rich-card layout, measured virtualization, and stable media/embed sizing are guarded.",
);
