import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Resolve source paths from this file's location (like verify-richtext.mjs) so
// the harness works regardless of the CWD a CI / pre-commit hook runs it from.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(resolve(repoRoot, "src/App.tsx"), "utf8");
const api = readFileSync(resolve(repoRoot, "src/api.ts"), "utf8");
const main = readFileSync(resolve(repoRoot, "src/main.tsx"), "utf8");
const infoPage = readFileSync(resolve(repoRoot, "src/InfoPage.tsx"), "utf8");
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

function requireInfoPattern(pattern, label) {
  if (!pattern.test(infoPage)) {
    failures.push(label);
  }
}

requirePattern(/const visibleSources = useMemo\(\(\) => \{[\s\S]*feedSearch\.trim\(\)[\s\S]*feedSources\.filter/s, "feed selector should filter locally from static feedSources");
requirePattern(/<input[\s\S]*className="feed-search"[\s\S]*onInput=\{\(event\) => setFeedSearch\(event\.currentTarget\.value\)\}/s, "feed selector input should only update local filter state");
requirePattern(/const navigate = useCallback\(\(nextRoute: RouteState[\s\S]*window\.history\.pushState[\s\S]*setRoute\(nextRoute\)/s, "navigation should stay inside the SPA shell");
requirePattern(/const submitSearch = \(query: string\) => \{[\s\S]*const path = `\/search\?q=\$\{encodeURIComponent\(trimmed\)\}`;[\s\S]*const routeState = \{ kind: "search", query: trimmed \} as const;[\s\S]*navigate\(routeState, path\);[\s\S]*\};/s, "search should fetch only after explicit search navigation");
requirePattern(/onQueryChange=\{setGlobalSearchText\}/, "search input should edit draft query state without direct fetch callbacks");
requirePattern(/shouldSuppressScrollSave\(offset\)/, "save-on-scroll should be suppressed while a saved offset is being restored");
// readScrollOffset / scrollOffsetTo / scrollFeedToTop and the per-key timeline
// scroll/anchor cache now live in src/lib/scroll.ts (issue #27 item 1) with real
// behavioral coverage in src/lib/scroll.test.ts (multi-scroller offset reads,
// write-all-scrollers restoration, instant back-to-top, the restore loop's
// suppression/supersede behavior, and the persistence round-trip + validation
// suites), so their source-regex guardrails were retired here per #19. The
// remaining pins below still match App wiring that stays in place (pagehide
// flush, session-cleanup, per-tab/profile surface keys).
requirePattern(/`profile:\$\{route\.actor\}:\$\{profileFeedFilterForTab\(profileTab\)\}`/, "profile timeline scroll keys should match the per-tab author-feed cache key");
requirePattern(/const restoreScrollFor = useCallback\([\s\S]*restoreOrResetScroll\(timelineRef, target\)/, "cached feed/profile loads should restore cached scroll offset (or reset the reused container to top when none) via the anchor-aware helper");
requirePattern(/restoreScrollFor\(cacheKey\)/, "feed/profile load sites should route scroll restoration through the content-anchor-aware helper");
requirePattern(/window\.addEventListener\("pagehide", persistScroll\)/, "timeline scroll offsets should flush before browser reloads");
requirePattern(/Object\.keys\(sessionStorage\)[\s\S]*key\.startsWith\("bigbsky:"\)[\s\S]*safeSessionStorageRemove\(key\)/s, "local reader data reset should clear browser-local session scroll state");
requirePattern(/route\.name === "bookmarks" \|\| route\.name === "lists"[\s\S]*`surface:\$\{route\.name\}`/s, "bookmarks and lists surfaces should receive route-specific scroll cache keys");
requirePattern(/function threadUnavailableState\([\s\S]*Blocked reply[\s\S]*Reply not found[\s\S]*Deleted reply[\s\S]*Reply temporarily unavailable/s, "thread unavailable states should distinguish blocked, deleted, not-found, and rate-limited branches");
requirePattern(/<div className=\{`thread-alert \$\{state\.tone\}`\}/, "thread unavailable branches should render typed alert tones");
forbidPattern(/timelineRef\.current\?\.scrollTo\(\{ top: 0 \}\)/, "feed switching should not force the timeline back to the top");
requirePattern(/cursor\s*\n?\s*\?\s*\{ \.\.\.current, status: "ready", loadMoreError: rateLimitMessage\(error\) \}/s, "a failed pagination request should keep already-loaded results instead of discarding them");
requirePattern(/catch \{\s*\/\/ Revert to pre-click state\.[\s\S]*pushToast\(\s*blocked \? "Couldn't unblock this account\. Please try again\." : "Couldn't block this account\. Please try again\.",\s*"error",\s*\);[\s\S]*\} finally \{[\s\S]*blockInFlight\.current\.delete/s, "a failed block/unblock write should surface an actionable error toast (not just revert silently)");
requirePattern(/console\.error\("Failed to sync feed order to account", error\);\s*pushToast\("Couldn't sync your feed order to your account\. It's saved on this browser\.", "error"\)/, "a failed saved-feed-order account sync should surface an error toast instead of logging silently");
requirePattern(/const toast = useContext\(ToastContext\);[\s\S]*setDeleting\(true\);[\s\S]*catch \{\s*toast\("Couldn't delete this list\. Please try again\.", "error"\);\s*\} finally \{[\s\S]*setDeleting\(false\);/s, "a failed list delete should surface an error toast");
requirePattern(/const loadMore = \(\) => \{[\s\S]*const controller = new AbortController\(\);[\s\S]*loadMoreControllerRef\.current = controller;/s, "pagination requests should carry an abort signal so a late page can be discarded");
requirePattern(/loadMoreControllerRef\.current\?\.abort\(\);[\s\S]*reloadProfileControllerRef\.current\?\.abort\(\);[\s\S]*\},\s*\[activeSource, profileTab, route, searchLanguage, searchSort, searchTab\]/s, "in-flight pagination and profile refetches should be aborted when the active surface changes");
requirePattern(/const reloadCurrentProfile = useCallback\(\(\) => \{[\s\S]*reloadProfileControllerRef\.current = controller;[\s\S]*loadProfileFeed\(route\.actor, undefined, controller\.signal, filter\)/s, "the post-publish profile refetch should be abortable");
requirePattern(/const pinnedFeedMetaStorageKey = "bigbsky:pinned-feed-meta"/, "discovered Feed pins should persist their metadata in a browser-local store");
requirePattern(/function readPinnedFeedMeta\(\)[\s\S]*isPinnedFeedMeta/s, "discovered Feed pin metadata should be read and validated from local storage");
requirePattern(/const knownIds = new Set\(\[\.\.\.feedSources\.map\(\(source\) => source\.id\), \.\.\.metaSources\.map\(\(source\) => source\.id\)\]\)/, "pinned Feed ids should resolve against both static and discovered Feed sources");
requirePattern(/setPinnedFeedMeta\(\(current\) => \{[\s\S]*safeLocalStorageSet\(pinnedFeedMetaStorageKey/s, "toggling a discovered Feed pin should sync its local metadata store");

// The Explore/profile-tab surface cluster moved to src/features/ (slice 14 of
// #18): ExploreTrendingTopics + ExploreDiscoverFeeds -> src/features/explore/,
// ProfileFeedsTab + ProfileListsTab (+ listPurposeLabel) -> src/features/profile/.
// Their old App.tsx definition regexes were retired per #19 in favor of the
// co-located RTL suites (ExploreTrendingTopics.test.tsx, ExploreDiscoverFeeds.test.tsx,
// ProfileFeedsTab.test.tsx, ProfileListsTab.test.tsx). The App call-site pins
// below (profileTab === "feeds"/"lists" render branches) stay because App still
// owns the tab switch.
requirePattern(/profileTab === "feeds" \? \(\s*<ProfileFeedsTab/s, "the profile Feeds tab should render published Feeds instead of the post list");
if (!/export function getActorFeeds\(/.test(api)) {
  failures.push("api should expose a public getActorFeeds reader");
}
requirePattern(/profileTab === "lists" \? \(\s*<ProfileListsTab/s, "the profile Lists tab should render published Lists instead of the post list");
if (!/export function getActorLists\(/.test(api)) {
  failures.push("api should expose a public getActorLists reader");
}
requirePattern(/isListUri\(source\.uri\)\s*\?\s*await getListFeed\(source\.uri, cursor, signal\)/s, "feed loading should read list timelines via getListFeed for list URIs");
requirePattern(/function BlueskyListCard\([\s\S]*useEffect\(\(\) => \{[\s\S]*setBlockUri\(list\.viewer\?\.blocked\);[\s\S]*setMuted\(\!\!list\.viewer\?\.muted\);[\s\S]*\}, \[list\.uri, list\.viewer\?\.blocked, list\.viewer\?\.muted\]\);/s, "Bluesky list block/mute controls should re-sync from refreshed viewer state");
if (!/export function getListFeed\(/.test(api) || !/export function getList\(/.test(api) || !/export function isListUri\(/.test(api)) {
  failures.push("api should expose public getListFeed/getList/isListUri helpers");
}
requirePattern(/setEngagement\(\(current\) => \(current === stat\.key \? null : stat\.key\)\)/, "thread reposts/quotes/likes counts should toggle an on-demand engagement panel");
if (!/export function getLikes\(/.test(api) || !/export function getRepostedBy\(/.test(api) || !/export function getQuotes\(/.test(api)) {
  failures.push("api should expose public getLikes/getRepostedBy/getQuotes readers");
}
// The thread engagement panel (ThreadEngagementPanel) moved to
// src/features/post/ThreadEngagementPanel.tsx (slice 13 of #18) with a
// behavioral RTL suite covering on-demand likes/reposts/quotes loading, empty
// states, rate-limit surfacing, load-more pagination + error retention, profile
// navigation, and close (ThreadEngagementPanel.test.tsx); the old App.tsx
// definition / loadMore regexes (on-demand loadPage, cursor pagination, and the
// load-more button) were retired per #19.
requirePattern(/<ErrorBoundary label=\{`post-row:\$\{post\.uri\}`\} fallback=\{\(\) => <PostRowFallback \/>\}>\s*\{children\}\s*<\/ErrorBoundary>/, "each virtualized row should be wrapped in a per-row error boundary so one bad record degrades a single row");
if (!/import\.meta\.env\.PROD[\s\S]*import\.meta\.env\.BASE_URL\}sw\.js/.test(main)) {
  failures.push("service-worker registration should be gated behind PROD and derive its path from BASE_URL");
}
// Rich-text rendering moved to src/features/post/RichText.tsx (slice 12 of
// #18): `renderRichText` now lives there with a behavioral RTL suite
// (RichText.test.tsx covering link/mention/tag segments and the in-app
// mention/tag navigation), and `segmentRichText` remains exercised by the
// executable scripts/verify-richtext.mjs harness. The old definition / import
// regex guardrails were retired per the #19 test-migration plan.
requirePattern(/renderRichText\(post\.record\.facets\?\.length \? post\.record\.text \|\| "" : text, post\.record\.facets, onOpenProfile/, "post cards should render rich-text facets for post body text");
requirePattern(/renderRichText\(\s*record\.value\?\.facets\?\.length \? record\.value\.text \|\| "" : text,\s*record\.value\?\.facets,\s*onOpenProfile,\s*onOpenTag,/s, "quoted posts should render rich-text facets for their body text");
requirePattern(/const gateMedia = !showNsfw && mediaWarningValues\.length > 0 && \(images\.length > 0 \|\| !!video\) && !mediaRevealed/, "adult/graphic media should be gated behind a reveal warning unless the NSFW preference is on");
requirePattern(/const showNsfw = useContext\(ShowNsfwContext\);\s*const visiblePosts = useMemo\([\s\S]*isAdultPost\(post\)\)/, "search results should drop adult-labeled posts entirely when the NSFW preference is hidden");
requirePattern(/\[\.\.\.labels, \.\.\.\(post\.author\.labels \?\? \[\]\)\]\.filter\(isSensitiveLabel\)/, "media gating should consider account-level (author) labels, not just post labels");
requirePattern(/const ShowNsfwContext = createContext<boolean>\(false\)/, "the NSFW preference should default to hidden for everyone");
requirePattern(/localStorage\.getItem\(showNsfwStorageKey\) === "true"/, "showing NSFW media should require an explicit stored opt-in");
requirePattern(/window\.confirm\([\s\S]*BigBSky will not ask for or store your birthday/s, "enabling NSFW media should require a local confirmation without collecting birthdate");
requirePattern(/safeLocalStorageSet\(showNsfwStorageKey, next \? "true" : "false"\)/, "the NSFW preference should persist in browser-local storage");
requireInfoPattern(/does not run a BigBsky user database[\s\S]*does not store adult-content preferences, birthday, age, ID, or verification data on a BigBsky server/, "Info page should disclose that BigBsky does not store adult-content or age-verification data on a server");
requireInfoPattern(/Cloudflare[\s\S]*aggregate\/anonymized analytics data/, "Info page should mention Cloudflare hosting analytics may be aggregate/anonymized");
requirePattern(/gateMedia \? \(\s*<SensitiveMediaGate values=\{mediaWarningValues\} onReveal=\{\(\) => setMediaRevealed\(true\)\}/s, "sensitive media should require an explicit Show click before rendering");
requirePattern(/const gateMedia = !showNsfw && mediaWarningValues\.length > 0 && \(embeddedImages\.length > 0 \|\| !!embeddedVideo\) && !mediaRevealed/, "quoted-post media should also be gated behind the sensitive-content warning");
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
