import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");
const failures = [];

function requirePattern(pattern, label) {
  if (!pattern.test(app)) {
    failures.push(label);
  }
}

function forbidPattern(pattern, label) {
  if (pattern.test(app)) {
    failures.push(label);
  }
}

requirePattern(/const visibleSources = useMemo\(\(\) => \{[\s\S]*feedSearch\.trim\(\)[\s\S]*feedSources\.filter/s, "feed selector should filter locally from static feedSources");
requirePattern(/<input[\s\S]*className="feed-search"[\s\S]*onInput=\{\(event\) => setFeedSearch\(event\.currentTarget\.value\)\}/s, "feed selector input should only update local filter state");
requirePattern(/function navigate\(nextRoute: RouteState[\s\S]*window\.history\.pushState[\s\S]*setRoute\(nextRoute\)/s, "navigation should stay inside the SPA shell");
requirePattern(/const submitSearch = \(query: string\) => \{[\s\S]*const path = `\/search\?q=\$\{encodeURIComponent\(trimmed\)\}`;[\s\S]*const routeState = \{ kind: "search", query: trimmed \} as const;[\s\S]*navigate\(routeState, path\);[\s\S]*\};/s, "search should fetch only after explicit search navigation");
requirePattern(/onQueryChange=\{setGlobalSearchText\}/, "search input should edit draft query state without direct fetch callbacks");
requirePattern(/scrollCacheRef\.current\[activeScrollKey\] = timeline\.scrollTop/, "timeline scroll should be cached per active feed/profile key");
requirePattern(/scrollCacheRef\.current\[cacheKey\] \|\| 0/, "cached feed/profile loads should restore cached scroll offset");
forbidPattern(/timelineRef\.current\?\.scrollTo\(\{ top: 0 \}\)/, "feed switching should not force the timeline back to the top");

if (failures.length > 0) {
  throw new Error(`Reader behavior verification failed: ${failures.join("; ")}`);
}

console.log("Reader behavior verification passed: feed filtering/search drafts are local, SPA navigation is explicit, and feed scroll restoration is preserved.");
