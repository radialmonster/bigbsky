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
requirePattern(/const offset = readScrollOffset\(timeline\);[\s\S]*scrollCacheRef\.current\[activeScrollKey\] = offset/, "timeline scroll should be cached per active feed/profile key from the active scroller");
requirePattern(/shouldSuppressScrollSave\(offset\)/, "save-on-scroll should be suppressed while a saved offset is being restored");
// readScrollOffset / scrollOffsetTo / scrollFeedToTop now live in src/lib/scroll.ts
// with real behavioral coverage in src/lib/scroll.test.ts (multi-scroller offset
// reads, write-all-scrollers restoration, instant back-to-top, and the restore
// loop's suppression/supersede behavior), so their source-regex guardrails were
// retired here per the test-migration plan in todo.md.
requirePattern(/`profile:\$\{route\.actor\}:\$\{profileFeedFilterForTab\(profileTab\)\}`/, "profile timeline scroll keys should match the per-tab author-feed cache key");
requirePattern(/const restoreScrollFor = useCallback\([\s\S]*restoreOrResetScroll\(timelineRef, target\)/, "cached feed/profile loads should restore cached scroll offset (or reset the reused container to top when none) via the anchor-aware helper");
requirePattern(/restoreScrollFor\(cacheKey\)/, "feed/profile load sites should route scroll restoration through the content-anchor-aware helper");
requirePattern(/const timelineScrollStorageKey = "bigbsky:timeline-scroll"/, "timeline scroll offsets should use a browser-local session cache key");
requirePattern(/sessionStorage\.setItem\(timelineScrollStorageKey, JSON\.stringify\(cache\)\)/, "timeline scroll offsets should persist across browser reloads");
requirePattern(/window\.addEventListener\("pagehide", persistScroll\)/, "timeline scroll offsets should flush before browser reloads");
requirePattern(/Object\.keys\(sessionStorage\)[\s\S]*key\.startsWith\("bigbsky:"\)[\s\S]*safeSessionStorageRemove\(key\)/s, "local reader data reset should clear browser-local session scroll state");
requirePattern(/route\.name === "bookmarks" \|\| route\.name === "lists"[\s\S]*`surface:\$\{route\.name\}`/s, "bookmarks and lists surfaces should receive route-specific scroll cache keys");
requirePattern(/activeScrollKey\.startsWith\("surface:"\)[\s\S]*const target = scrollCacheRef\.current\[activeScrollKey\] \|\| 0;[\s\S]*restoreOrResetScroll\(timelineRef, target\)/s, "saved and lists surfaces should restore cached scroll offset when revisited");
requirePattern(/function threadUnavailableState\([\s\S]*Blocked reply[\s\S]*Reply not found[\s\S]*Deleted reply[\s\S]*Reply temporarily unavailable/s, "thread unavailable states should distinguish blocked, deleted, not-found, and rate-limited branches");
requirePattern(/<div className=\{`thread-alert \$\{state\.tone\}`\}/, "thread unavailable branches should render typed alert tones");
forbidPattern(/timelineRef\.current\?\.scrollTo\(\{ top: 0 \}\)/, "feed switching should not force the timeline back to the top");
requirePattern(/cursor\s*\n?\s*\?\s*\{ \.\.\.current, status: "ready", loadMoreError: rateLimitMessage\(error\) \}/s, "a failed pagination request should keep already-loaded results instead of discarding them");
requirePattern(/catch \{\s*\/\/ Revert to pre-click state\.[\s\S]*pushToast\(\s*blocked \? "Couldn't unblock this account\. Please try again\." : "Couldn't block this account\. Please try again\.",\s*"error",\s*\);[\s\S]*\} finally \{[\s\S]*blockInFlight\.current\.delete/s, "a failed block/unblock write should surface an actionable error toast (not just revert silently)");
requirePattern(/console\.error\("Failed to sync feed order to account", error\);\s*pushToast\("Couldn't sync your feed order to your account\. It's saved on this browser\.", "error"\)/, "a failed saved-feed-order account sync should surface an error toast instead of logging silently");
requirePattern(/const toast = useContext\(ToastContext\);[\s\S]*setDeleting\(true\);[\s\S]*catch \{\s*toast\("Couldn't delete this list\. Please try again\.", "error"\);\s*\} finally \{[\s\S]*setDeleting\(false\);/s, "a failed list delete should surface an error toast");
requirePattern(/if \(!button \|\| error \|\| !\("IntersectionObserver" in window\)\)/, "the auto-loader should stop firing after a pagination error to avoid retry storms");
requirePattern(/const loadMore = \(\) => \{[\s\S]*const controller = new AbortController\(\);[\s\S]*loadMoreControllerRef\.current = controller;/s, "pagination requests should carry an abort signal so a late page can be discarded");
requirePattern(/loadMoreControllerRef\.current\?\.abort\(\);[\s\S]*reloadProfileControllerRef\.current\?\.abort\(\);[\s\S]*\},\s*\[activeSource, profileTab, route, searchLanguage, searchSort, searchTab\]/s, "in-flight pagination and profile refetches should be aborted when the active surface changes");
requirePattern(/const reloadCurrentProfile = useCallback\(\(\) => \{[\s\S]*reloadProfileControllerRef\.current = controller;[\s\S]*loadProfileFeed\(route\.actor, undefined, controller\.signal, filter\)/s, "the post-publish profile refetch should be abortable");
requirePattern(/const pinnedFeedMetaStorageKey = "bigbsky:pinned-feed-meta"/, "discovered Feed pins should persist their metadata in a browser-local store");
requirePattern(/function readPinnedFeedMeta\(\)[\s\S]*isPinnedFeedMeta/s, "discovered Feed pin metadata should be read and validated from local storage");
requirePattern(/const knownIds = new Set\(\[\.\.\.feedSources\.map\(\(source\) => source\.id\), \.\.\.metaSources\.map\(\(source\) => source\.id\)\]\)/, "pinned Feed ids should resolve against both static and discovered Feed sources");
requirePattern(/setPinnedFeedMeta\(\(current\) => \{[\s\S]*safeLocalStorageSet\(pinnedFeedMetaStorageKey/s, "toggling a discovered Feed pin should sync its local metadata store");

requirePattern(/function ExploreTrendingTopics\([\s\S]*getTrendingTopics\([\s\S]*onOpenSearchQuery\(topic\.topic\)/s, "Explore trending topics should load live topics and open them as in-app searches");
requirePattern(/function TrendingPanel\([\s\S]*getTrendingTopics\(10, controller\.signal\)[\s\S]*fallback\.length > 0/s, "the right-rail Trending panel should load live trending topics with a loaded-post fallback");
requirePattern(/} else if \(searchTab === "feeds"\) \{[\s\S]*loadFeedSearch\(route\.query, controller\.signal\)/s, "the Feeds search tab should run a live public Feed search only after explicit search navigation");
requirePattern(/const loadFeedSearch = useCallback\([\s\S]*getPopularFeedGenerators\(20, signal, query\)/s, "live Feed search should query the public popular-feed-generators endpoint");
requirePattern(/className="discover-feeds-search"[\s\S]*setActiveQuery\(draftQuery\.trim\(\)\)/s, "Explore Discover New Feeds should only refetch on explicit search submit");
requirePattern(/getPopularFeedGenerators\(18, controller\.signal, activeQuery\)[\s\S]*\}, \[activeQuery\]\)/s, "Explore Discover New Feeds should refetch when the committed query changes");
requirePattern(/const profileTabs = \["posts", "replies", "media", "videos", "feeds"/, "public profiles should expose a Feeds tab");
requirePattern(/function ProfileFeedsTab\([\s\S]*getActorFeeds\(actor, 50, signal, cursor\)/s, "the profile Feeds tab should load the actor's published Feeds from the public endpoint");
requirePattern(/function ProfileFeedsTab\([\s\S]*const loadPage = useCallback\([\s\S]*response\.feeds, cursor: response\.cursor/s, "the profile Feeds tab should paginate published Feeds via the response cursor");
requirePattern(/function ProfileFeedsTab\([\s\S]*const loadMore = useCallback\([\s\S]*loadPage\(state\.cursor, controller\.signal\)[\s\S]*feeds: \[\.\.\.current\.feeds, \.\.\.feeds\],[\s\S]*\bcursor,/s, "the profile Feeds tab should append later pages and advance the cursor");
requirePattern(/profileTab === "feeds" \? \(\s*<ProfileFeedsTab/s, "the profile Feeds tab should render published Feeds instead of the post list");
if (!/export function getActorFeeds\(/.test(api)) {
  failures.push("api should expose a public getActorFeeds reader");
}
requirePattern(/const profileTabs = \["posts", "replies", "media", "videos", "feeds", "lists"\]/, "public profiles should expose a Lists tab");
requirePattern(/function ProfileListsTab\([\s\S]*getActorLists\(actor, 50, signal, cursor\)/s, "the profile Lists tab should load the actor's published Lists from the public endpoint");
requirePattern(/function ProfileListsTab\([\s\S]*const loadPage = useCallback\([\s\S]*response\.lists, cursor: response\.cursor/s, "the profile Lists tab should paginate published Lists via the response cursor");
requirePattern(/function ProfileListsTab\([\s\S]*const loadMore = useCallback\([\s\S]*loadPage\(state\.cursor, controller\.signal\)[\s\S]*lists: \[\.\.\.current\.lists, \.\.\.lists\],[\s\S]*\bcursor,/s, "the profile Lists tab should append later pages and advance the cursor");
requirePattern(/profileTab === "lists" \? \(\s*<ProfileListsTab/s, "the profile Lists tab should render published Lists instead of the post list");
if (!/export function getActorLists\(/.test(api)) {
  failures.push("api should expose a public getActorLists reader");
}
requirePattern(/isListUri\(source\.uri\)\s*\?\s*await getListFeed\(source\.uri, cursor, signal\)/s, "feed loading should read list timelines via getListFeed for list URIs");
requirePattern(/isCurateList\s*\?\s*\(\s*<button type="button" className="discover-feed-open" onClick=\{\(\) => onOpenFeed\(source\)\}/s, "curated lists should open their timeline in-app from the profile Lists tab");
requirePattern(/function BlueskyListCard\([\s\S]*useEffect\(\(\) => \{[\s\S]*setBlockUri\(list\.viewer\?\.blocked\);[\s\S]*setMuted\(\!\!list\.viewer\?\.muted\);[\s\S]*\}, \[list\.uri, list\.viewer\?\.blocked, list\.viewer\?\.muted\]\);/s, "Bluesky list block/mute controls should re-sync from refreshed viewer state");
if (!/export function getListFeed\(/.test(api) || !/export function getList\(/.test(api) || !/export function isListUri\(/.test(api)) {
  failures.push("api should expose public getListFeed/getList/isListUri helpers");
}
requirePattern(/function ThreadEngagementPanel\([\s\S]*kind === "likes"[\s\S]*getLikes\(uri[\s\S]*getRepostedBy\(uri[\s\S]*getQuotes\(uri/s, "the thread engagement panel should load likes, reposts, and quotes on demand");
requirePattern(/setEngagement\(\(current\) => \(current === stat\.key \? null : stat\.key\)\)/, "thread reposts/quotes/likes counts should toggle an on-demand engagement panel");
if (!/export function getLikes\(/.test(api) || !/export function getRepostedBy\(/.test(api) || !/export function getQuotes\(/.test(api)) {
  failures.push("api should expose public getLikes/getRepostedBy/getQuotes readers");
}
requirePattern(/function ThreadEngagementPanel\([\s\S]*const loadPage = useCallback\([\s\S]*response\.likes\.map\(\(like\) => like\.actor\)[\s\S]*response\.repostedBy[\s\S]*response\.posts[\s\S]*response\.cursor/s, "the engagement panel should paginate likes, reposts, and quotes via the response cursor");
requirePattern(/const loadMore = useCallback\([\s\S]*loadPage\(state\.cursor, controller\.signal\)[\s\S]*setState\(\(current\) => \([\s\S]*\bcursor,/s, "the engagement panel should append later pages and advance the cursor");
requirePattern(/state\.status === "ready" && state\.cursor && \(\s*<AutoLoadMoreButton\s+label=\{`Load more/, "the engagement panel should offer load-more while a cursor remains");
requirePattern(/<ErrorBoundary label=\{`post-row:\$\{post\.uri\}`\} fallback=\{\(\) => <PostRowFallback \/>\}>\s*\{children\}\s*<\/ErrorBoundary>/, "each virtualized row should be wrapped in a per-row error boundary so one bad record degrades a single row");
requirePattern(/function PostRowFallback\(\)[\s\S]*className="post-row-error"[\s\S]*role="alert"/s, "the per-row boundary should render a compact alert fallback instead of unmounting the feed");
if (!/import\.meta\.env\.PROD[\s\S]*import\.meta\.env\.BASE_URL\}sw\.js/.test(main)) {
  failures.push("service-worker registration should be gated behind PROD and derive its path from BASE_URL");
}
requirePattern(/import \{ segmentRichText \} from "\.\/richtext"/, "rich-text facet segmentation should come from the pure src/richtext.ts helper");
requirePattern(/function renderRichText\([\s\S]*segmentRichText\(text, facets\)[\s\S]*segment\.kind === "link"[\s\S]*segment\.kind === "mention"[\s\S]*segment\.kind === "tag"/s, "post text should render link, mention, and tag facet segments from Bluesky rich text");
requirePattern(/const TagSearchContext = createContext[\s\S]*onClick=\{\(event\) => \{[\s\S]*onOpenTag\(tag\)/s, "hashtag facets should open an in-app search via the tag-search context");
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
