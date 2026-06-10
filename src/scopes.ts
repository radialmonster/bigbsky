// The single source of truth for the AT Protocol OAuth scopes BigBSky requests
// is the static client metadata document, public/oauth-client-metadata.json.
// That JSON is what the authorization server actually fetches (at the client_id
// URL) and enforces. This module re-exports its `scope` string so that app code
// (e.g. the loopback / localhost client id built in auth.ts) and the published
// metadata can never drift apart — there is exactly one place to edit.
//
// BigBSky is mostly an alternative reading theme for Bluesky: read broadly,
// write narrowly. The scope tokens in the JSON, with the rationale for each:
//
//   atproto
//     Required base scope; identifies the account.
//
//   rpc:*?aud=did:web:api.bsky.app%23bsky_appview
//     READ + AppView writes. Every AppView query the reader makes (timeline,
//     feeds, threads, profiles, lists, search, notifications) plus the AppView
//     procedures we use: saving/pinning feeds & lists (actor.putPreferences)
//     and muting accounts/threads/lists (graph.mute*). Scoped to the AppView
//     audience only — no repo-write power, no PDS admin, no chat. `rpc` covers
//     both query and procedure methods, so putPreferences/mute need no separate
//     scope. The `#` fragment in `aud` is percent-encoded as `%23` per the
//     permission spec.
//
//   repo:app.bsky.feed.post        new posts + replies/comments (quotes reuse this)
//   repo:app.bsky.feed.like        like / unlike
//   repo:app.bsky.graph.follow     follow / unfollow an account
//   repo:app.bsky.graph.block      block / unblock an account directly
//   repo:app.bsky.graph.list       create a list (e.g. a moderation/block list)
//   repo:app.bsky.graph.listitem   add / remove accounts in a list we own
//   repo:app.bsky.graph.listblock  subscribe / unsubscribe to a block list
//   blob:image/*                   image attachments on posts
//
// Anything not listed is intentionally delegated to bsky.app (reposts, profile
// edits, reports, DMs, account/email, handle/identity changes).

import clientMetadata from "../public/oauth-client-metadata.json";

// The real AppView service DID (with a `#fragment`). Exported for reference;
// inside an `aud` scope parameter the `#` is percent-encoded as `%23`.
export const APPVIEW_AUD = "did:web:api.bsky.app#bsky_appview";

// Derived from the metadata document so the two can never disagree.
export const OAUTH_SCOPE: string = clientMetadata.scope;
