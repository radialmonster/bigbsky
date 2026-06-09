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

requirePattern(app, /const widthModes = \["balanced", "wide", "focus"\] as const;/, "reader should keep explicit desktop width modes");
requirePattern(app, /const \[workspaceWidth, setWorkspaceWidth\][\s\S]*readWorkspaceWidthPreference\(\)/, "reader width preference should apply before first paint");
requirePattern(app, /localStorage\.setItem\(workspaceWidthStorageKey, nextWidth\)/, "reader width preference should persist locally");

requirePattern(app, /function VirtualPostList\([\s\S]*defaultRowHeight = density === "compact" \? 190 : density === "media" \? 360 : 260/s, "virtual rows should use density-aware estimated heights");
requirePattern(app, /const overscanPixels = defaultRowHeight \* 3/, "virtual list should overscan a bounded row window");
requirePattern(app, /function VirtualPostList\([\s\S]*const findRowIndex = useCallback\([\s\S]*while \(low <= high\)/s, "virtual list should locate rows by offset without scanning all rows on scroll");
requirePattern(app, /data-total-rows=\{items\.length\}[\s\S]*data-rendered-rows=\{visibleItems\.length\}/s, "virtual list should expose loaded and rendered row counts");
requirePattern(app, /topSpacerHeight > 0[\s\S]*bottomSpacerHeight > 0/s, "virtual list should use top and bottom spacers instead of mounting all rows");
requirePattern(app, /rowTop \+ previousHeight <= container\.scrollTop[\s\S]*container\.scrollTop \+= height - previousHeight/s, "measured row updates should compensate scroll position above the viewport");
requirePattern(app, /onRenderedRowsChange\(visibleItems\.length\)/, "development inspector should receive rendered row counts");

requirePattern(app, /image\.aspectRatio\?\.width && image\.aspectRatio\?\.height[\s\S]*aspectRatio: `\$\{image\.aspectRatio\.width\} \/ \$\{image\.aspectRatio\.height\}`/s, "image embeds should use Bluesky aspect-ratio metadata");
requirePattern(app, /video\.aspectRatio\?\.width && video\.aspectRatio\?\.height[\s\S]*aspectRatio: `\$\{video\.aspectRatio\.width\} \/ \$\{video\.aspectRatio\.height\}`/s, "video embeds should use Bluesky aspect-ratio metadata");
requirePattern(css, /\.post-card \{[\s\S]*contain: content;/s, "post cards should use containment to limit repaint scope");
requirePattern(css, /\.post-card\.has-media,[\s\S]*--post-embed-min: 220px;/s, "rich post cards should reserve stable embed space");
requirePattern(css, /\.link-card \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/s, "link cards should have stable desktop grid sizing");
requirePattern(css, /\.media \.post-card\.has-media \.image-grid\.count-1 img,[\s\S]*min-height: min\(46vh, 420px\);/s, "media density should reserve larger media height");

requirePattern(css, /\.width-wide \{[\s\S]*grid-template-columns: 76px 260px minmax\(780px, 1\.35fr\) 280px;/s, "wide mode should allocate more width to the reader before rails");
requirePattern(css, /\.width-focus \{[\s\S]*grid-template-columns: 76px 228px minmax\(860px, 1\.5fr\) 0;/s, "focus mode should allocate reader width and collapse the right rail");
requirePattern(css, /@media \(min-width: 1900px\) \{[\s\S]*\.app-shell \{[\s\S]*grid-template-columns: 76px 300px minmax\(980px, 1fr\) 340px;/s, "very wide screens should increase the active reader track");
requirePattern(css, /@media \(min-width: 1900px\) \{[\s\S]*\.timeline\.compact \.post-card\.has-link,[\s\S]*display: grid;[\s\S]*grid-template-columns: minmax\(280px, 0\.92fr\) minmax\(360px, 1\.08fr\);/s, "very wide compact rich cards should become two-zone cards");
requirePattern(css, /@media \(min-width: 1900px\) \{[\s\S]*\.app-shell\.width-wide \{[\s\S]*minmax\(1100px,[\s\S]*\.app-shell\.width-focus \{[\s\S]*minmax\(1280px,[\s\S]*0;/s, "very wide screens should keep widening Wide/Focus reader modes (and Focus must not leave an empty right-rail gutter)");
requirePattern(css, /@media \(min-width: 2560px\) \{[\s\S]*\.app-shell \{[\s\S]*minmax\(1200px, 1fr\)/s, "ultrawide screens should spend extra width on the reader column");
requirePattern(css, /@media \(max-width: 720px\) \{[\s\S]*\.compact \.post-card\.text-only \{[\s\S]*display: block;/s, "wide-only compact layout should collapse on mobile");

forbidPattern(css, /\.timeline\s*\{[^}]*max-width:\s*6\d\dpx/s, "timeline should not be capped to a narrow mobile column");
forbidPattern(css, /\.post-card\s*\{[^}]*max-width:\s*6\d\dpx/s, "post cards should not be capped to a narrow mobile column");

if (failures.length > 0) {
  throw new Error(`Layout behavior verification failed: ${failures.join("; ")}`);
}

console.log(
  "Layout behavior verification passed: width modes, very-wide rich-card layout, measured virtualization, and stable media/embed sizing are guarded.",
);
