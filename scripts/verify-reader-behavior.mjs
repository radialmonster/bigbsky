import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");
const api = readFileSync("src/api.ts", "utf8");
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
requirePattern(/const timelineScrollStorageKey = "bigbsky:timeline-scroll"/, "timeline scroll offsets should use a browser-local session cache key");
requirePattern(/sessionStorage\.setItem\(timelineScrollStorageKey, JSON\.stringify\(cache\)\)/, "timeline scroll offsets should persist across browser reloads");
requirePattern(/window\.addEventListener\("pagehide", persistScroll\)/, "timeline scroll offsets should flush before browser reloads");
requirePattern(/Object\.keys\(sessionStorage\)[\s\S]*key\.startsWith\("bigbsky:"\)[\s\S]*sessionStorage\.removeItem\(key\)/s, "local reader data reset should clear browser-local session scroll state");
requirePattern(/route\.name === "saved" \|\| route\.name === "lists"[\s\S]*`surface:\$\{route\.name\}`/s, "saved and lists surfaces should receive route-specific scroll cache keys");
requirePattern(/activeScrollKey\.startsWith\("surface:"\)[\s\S]*timelineRef\.current\?\.scrollTo\(\{ top: scrollCacheRef\.current\[activeScrollKey\] \|\| 0 \}\)/s, "saved and lists surfaces should restore cached scroll offset when revisited");
requirePattern(/function threadUnavailableState\([\s\S]*Blocked reply[\s\S]*Reply not found[\s\S]*Deleted reply[\s\S]*Reply temporarily unavailable/s, "thread unavailable states should distinguish blocked, deleted, not-found, and rate-limited branches");
requirePattern(/<div className=\{`thread-alert \$\{state\.tone\}`\}/, "thread unavailable branches should render typed alert tones");
forbidPattern(/timelineRef\.current\?\.scrollTo\(\{ top: 0 \}\)/, "feed switching should not force the timeline back to the top");
requirePattern(/const pinnedFeedMetaStorageKey = "bigbsky:pinned-feed-meta"/, "discovered Feed pins should persist their metadata in a browser-local store");
requirePattern(/function readPinnedFeedMeta\(\)[\s\S]*isPinnedFeedMeta/s, "discovered Feed pin metadata should be read and validated from local storage");
requirePattern(/const knownIds = new Set\(\[\.\.\.feedSources\.map\(\(source\) => source\.id\), \.\.\.metaSources\.map\(\(source\) => source\.id\)\]\)/, "pinned Feed ids should resolve against both static and discovered Feed sources");
requirePattern(/setPinnedFeedMeta\(\(current\) => \{[\s\S]*localStorage\.setItem\(pinnedFeedMetaStorageKey/s, "toggling a discovered Feed pin should sync its local metadata store");

requirePattern(/function ExploreTrendingTopics\([\s\S]*getTrendingTopics\([\s\S]*onOpenSearchQuery\(topic\.topic\)/s, "Explore trending topics should load live topics and open them as in-app searches");
if (!/export function getTrendingTopics\(/.test(api)) {
  failures.push("api should expose a public getTrendingTopics reader");
}

if (!/candidate\.media\?\.images/.test(api) || !/recordContainer[\s\S]*"record" in recordContainer[\s\S]*recordContainer\.record/s.test(api)) {
  failures.push("embed helpers should support AppView recordWithMedia image and quote records");
}

if (failures.length > 0) {
  throw new Error(`Reader behavior verification failed: ${failures.join("; ")}`);
}

console.log("Reader behavior verification passed: feed filtering/search drafts are local, SPA navigation is explicit, and feed scroll restoration is preserved.");
