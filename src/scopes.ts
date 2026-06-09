// Single source of truth for the AT Protocol OAuth scopes BigBSky requests.
//
// Strategy: BigBSky is a wide-screen *reader*. We read broadly from the public
// AppView, but write narrowly to the user's repo. Anything not granted here is
// intentionally delegated to bsky.app (profile edits, blocks, reports, DMs,
// account/email, handle/identity changes).
//
// NOTE: For the production client this string must stay in sync with the
// `scope` field in public/oauth-client-metadata.json — that static document is
// what the authorization server actually reads. This module is the canonical
// copy and is used directly to build the loopback (localhost) client id.

// All `rpc` (AppView method) scopes target the Bluesky AppView service.
export const APPVIEW_AUD = "did:web:api.bsky.app#bsky_appview";

const scopeTokens = [
  // Required base scope: identifies the account.
  "atproto",

  // READ — every AppView query the reader makes (timeline, feeds, threads,
  // profiles, lists, search, notifications) plus AppView-side writes we expose:
  // saving/pinning feeds (actor.putPreferences) and muting accounts/threads/
  // lists (graph.mute*). `rpc` scopes cannot wildcard a namespace prefix, and
  // the read surface includes volatile `unspecced` discovery methods, so we
  // scope the wildcard to the AppView audience only. This grants no repo-write
  // power and no other audience (PDS admin, chat).
  `rpc:*?aud=${APPVIEW_AUD}`,

  // WRITE — records created in the user's own repo. Omitting the `action`
  // param grants create/update/delete, which is what un-like / un-repost /
  // un-follow / list editing require.
  "repo:app.bsky.feed.post", // posts, replies, quotes
  "repo:app.bsky.feed.like", // like / unlike
  "repo:app.bsky.feed.repost", // repost / unrepost
  "repo:app.bsky.graph.follow", // follow / unfollow
  "repo:app.bsky.graph.list", // create / edit curation lists
  "repo:app.bsky.graph.listitem", // add / remove list members

  // MEDIA — image attachments on posts. Add "blob:video/*" when/if we support
  // video uploads.
  "blob:image/*",
];

export const OAUTH_SCOPE = scopeTokens.join(" ");
