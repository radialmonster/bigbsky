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
requirePattern(/const submitSearch = useCallback\([\s\S]*\(query: string\) => \{[\s\S]*const path = `\/search\?q=\$\{encodeURIComponent\(trimmed\)\}`;[\s\S]*const routeState = \{ kind: "search", query: trimmed \} as const;[\s\S]*navigate\(routeState, path\);[\s\S]*\},[\s\S]*\);/s, "search should fetch only after explicit search navigation");
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
// The `restoreScrollFor(cacheKey)` call site (cached feed/profile loads routing
// through the anchor-aware helper) moved to src/lib/loaders.ts with the data
// loaders (issue #28); it is covered behaviorally by src/lib/loaders.test.tsx
// (feed/profile cache-hit restoreScrollFor invocation). Retired per #19.
requirePattern(/window\.addEventListener\("pagehide", persistScroll\)/, "timeline scroll offsets should flush before browser reloads");
requirePattern(/Object\.keys\(sessionStorage\)[\s\S]*key\.startsWith\("bigbsky:"\)[\s\S]*safeSessionStorageRemove\(key\)/s, "local reader data reset should clear browser-local session scroll state");
requirePattern(/route\.name === "bookmarks" \|\| route\.name === "lists"[\s\S]*`surface:\$\{route\.name\}`/s, "bookmarks and lists surfaces should receive route-specific scroll cache keys");
requirePattern(/function threadUnavailableState\([\s\S]*Blocked reply[\s\S]*Reply not found[\s\S]*Deleted reply[\s\S]*Reply temporarily unavailable/s, "thread unavailable states should distinguish blocked, deleted, not-found, and rate-limited branches");
requirePattern(/<div className=\{`thread-alert \$\{state\.tone\}`\}/, "thread unavailable branches should render typed alert tones");
forbidPattern(/timelineRef\.current\?\.scrollTo\(\{ top: 0 \}\)/, "feed switching should not force the timeline back to the top");
// The `cursor ? { ...current, status: "ready", loadMoreError: rateLimitMessage(error) }`
// load-more error retention moved to src/lib/loaders.ts with the data loaders
// (issue #28); covered behaviorally by src/lib/loaders.test.tsx (pagination error
// keeps already-loaded results). Retired per #19.
requirePattern(/catch \{\s*\/\/ Revert to pre-click state\.[\s\S]*pushToast\(\s*blocked \? "Couldn't unblock this account\. Please try again\." : "Couldn't block this account\. Please try again\.",\s*"error",\s*\);[\s\S]*\} finally \{[\s\S]*blockInFlight\.current\.delete/s, "a failed block/unblock write should surface an actionable error toast (not just revert silently)");
requirePattern(/console\.error\("Failed to sync feed order to account", error\);\s*pushToast\("Couldn't sync your feed order to your account\. It's saved on this browser\.", "error"\)/, "a failed saved-feed-order account sync should surface an error toast instead of logging silently");
// The Lists cluster (ListMemberManager, BlueskyListCard, ListsSurface +
// listToFeedSource/listBskyUrl + the LocalList type) moved to
// src/features/lists/ListsSurface.tsx (slice 16 of #18), covered behaviorally by
// the co-located ListsSurface.test.tsx suite (list-delete error toast +
// viewer-state re-sync). The old App.tsx list-delete toast + viewer re-sync
// regexes were retired per #19.
requirePattern(/const loadMore = \(\) => \{[\s\S]*const controller = new AbortController\(\);[\s\S]*loadMoreControllerRef\.current = controller;/s, "pagination requests should carry an abort signal so a late page can be discarded");
requirePattern(/loadMoreControllerRef\.current\?\.abort\(\);[\s\S]*reloadProfileControllerRef\.current\?\.abort\(\);[\s\S]*\},\s*\[activeSource, profileTab, route, searchLanguage, searchSort, searchTab\]/s, "in-flight pagination and profile refetches should be aborted when the active surface changes");
requirePattern(/const reloadCurrentProfile = useCallback\(\(\) => \{[\s\S]*reloadProfileControllerRef\.current = controller;[\s\S]*loadProfileFeed\(route\.actor, undefined, controller\.signal, filter\)/s, "the post-publish profile refetch should be abortable");
// The pinned-feed-meta cluster (pinnedFeedMetaStorageKey, readPinnedFeedMeta,
// readPinnedFeedIds, writePinnedFeedMeta + the pinnedFeedsStorageKey write path)
// moved to src/lib/feed-meta.ts (co-located with its isPinnedFeedMeta validator,
// per #19). Its read/validate/cap/resolution behavior is covered behaviorally by
// the expanded src/lib/feed-meta.test.ts suite (read round-trip, malformed-entry
// filtering, non-JSON fallback, 12-entry cap, knownIds resolution against static
// + meta sources). The old App.tsx source pins were retired per #19.

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
// The list-timeline loader path (`isListUri(source.uri) ? await getListFeed(...)`)
// moved to src/lib/loaders.ts with the data loaders (issue #28); covered
// behaviorally by src/lib/loaders.test.tsx (feed loader list-URI routing).
// Retired per #19.
// The Lists cluster (ListMemberManager, BlueskyListCard, ListsSurface +
// listToFeedSource/listBskyUrl + the LocalList type) moved to
// src/features/lists/ListsSurface.tsx (slice 16 of #18), covered behaviorally by
// the co-located ListsSurface.test.tsx suite (list-delete error toast +
// viewer-state re-sync). The old App.tsx BlueskyListCard viewer re-sync regex
// was retired per #19.
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
// Media-reveal gating decision moved into the shared in-file useMediaReveal
// hook (#43). The old per-site `const gateMedia = !showNsfw && ...` source pins
// (post media, the SensitiveMediaGate reveal, and quoted-post media) were
// retired per the #19 test-migration plan; the gate/hide/thumbnail decision
// matrix is now behaviorally covered by src/App.media-reveal.test.tsx.
requirePattern(/const showNsfw = useContext\(ShowNsfwContext\);\s*const visiblePosts = useMemo\([\s\S]*isAdultPost\(post\)\)/, "search results should drop adult-labeled posts entirely when the NSFW preference is hidden");
requirePattern(/\[\.\.\.labels, \.\.\.\(post\.author\.labels \?\? \[\]\)\]\.filter\(isSensitiveLabel\)/, "media gating should consider account-level (author) labels, not just post labels");
requirePattern(/const ShowNsfwContext = createContext<boolean>\(false\)/, "the NSFW preference should default to hidden for everyone");
requirePattern(/localStorage\.getItem\(showNsfwStorageKey\) === "true"/, "showing NSFW media should require an explicit stored opt-in");
requirePattern(/window\.confirm\([\s\S]*BigBSky will not ask for or store your birthday/s, "enabling NSFW media should require a local confirmation without collecting birthdate");
requirePattern(/safeLocalStorageSet\(showNsfwStorageKey, next \? "true" : "false"\)/, "the NSFW preference should persist in browser-local storage");
requireInfoPattern(/does not run a BigBsky user database[\s\S]*does not store adult-content preferences, birthday, age, ID, or verification data on a BigBsky server/, "Info page should disclose that BigBsky does not store adult-content or age-verification data on a server");
requireInfoPattern(/Cloudflare[\s\S]*aggregate\/anonymized analytics data/, "Info page should mention Cloudflare hosting analytics may be aggregate/anonymized");
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
