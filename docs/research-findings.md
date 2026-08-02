## `bsky.app` Layout Findings

Observed signed-in `bsky.app` desktop layout at a wide monitor size:

- Signed-in account switcher is in the left rail.
- Left navigation exposes Home, Explore, Notifications, Chat, Feeds, Lists, Saved, Profile, Settings, and New post.
- Main feed remains about 600px wide even on a very wide screen.
- Feed tabs include Discover, Following, and user/custom feeds such as Designsky, Graphic Design, Trading, Stock Market, Tech news, Gaming, Music & Audio People, AudioSky, Videography/Filmography, OnlyPosts, and Mentions.
- The feed tab menu scrolls horizontally as more feeds extend off-screen to the right, which is a poor desktop organization pattern.
- Signed-in timelines include an inline composer/input near the top so the user can create their own post from the current browsing context, including attaching images.
- The composer supports multi-post/thread creation. `bsky.app` exposes this as a multi-post composer with actions such as Drafts, Post All, per-post delete, and per-post media controls.
- Bluesky posts have a 300-character limit per post, so the composer needs a clear counter and validation for each post in a thread.
- Right rail contains search, suggested/more feeds, trending topics, and footer/help links.
- The app uses wide screens mostly as gutters and rails around a narrow mobile-style timeline.

The signed-in app effectively has three navigation/menu regions:

- Left sidebar: primary app/account navigation.
- Top feed menu: active feed selection across Discover, Following, custom feeds, and mentions.
- Right sidebar: search, discovery, trending, and secondary links.

BigBSky should not copy the horizontal top feed bar. Feed selection needs to move into a more scalable desktop pattern.

BigBSky should keep the same signed-in information surfaces, but use the active Feed timeline differently:

- Keep account/nav/actions visible without giving them excessive horizontal importance.
- Preserve the left and right sidebar concepts where they help orientation.
- Replace the top horizontal feed menu with a feed selector that can scale to many feeds without horizontal scrolling.
- Make feeds easier to scan, pin, group, reorder, collapse, filter, or search.
- Treat Bluesky Feeds conceptually like topic/community destinations a user moves between, similar to how a user might browse communities elsewhere, while keeping Bluesky's naming: "Feeds", not "subreddits" or another borrowed term.
- Keep endless scrolling as a first-class interaction.
- Make posts, media, link cards, quote posts, and thread previews use wider desktop cards where it improves readability or scanning.
- Preserve and improve the inline post composer at the top of the active Feed timeline, including image attachment, multi-post/thread composition, and 300-character-per-post limit handling.
- Preserve scroll position while inspecting a post, thread, profile, image, or link card.
- Turn the right rail into useful live context instead of mostly static accessory content.
- Avoid forcing every task through one 600px vertical timeline.

## Signed-In Information Parity

For signed-in users, BigBSky should aim to expose the same categories of information and controls available on the main Bluesky site:

- Account identity and account switching.
- Home timeline.
- Discover timeline.
- Following feed.
- User-pinned and custom feeds.
- Mentions.
- Notifications. Status: partial; the route now has a browser-local inbox with All/Mentions controls, local reader/account events, and browser-local notification pins while authenticated notification reads remain pending.
- Chat entry point/status, with direct-message functionality deferred unless safe API support and privacy posture are clear.
- Feed directory and feed suggestions.
- Lists. Status: partial; the route now has browser-local list workspaces with create/delete, post membership from loaded reader cards, local list timelines, and empty states, while authenticated Bluesky list sync/timelines remain pending.
- Saved posts.
- Profile view and self-profile link.
- Settings entry point or local settings, depending on which settings can be safely represented through APIs.
- Search.
- Trending topics.
- Composer for new posts.
- Inline composer/input at the top of the active Feed timeline.
- Image attachment in the composer.
- Multi-post/thread composer.
- Per-post media controls.
- Drafts and Post All flow.
- 300-character composer counter and disabled/error state per post when over limit.
- Composer controls for interaction permissions, GIFs, emoji, and language where supported.
- Post actions: reply, repost/quote, like, save, share, more/options. Status: partial; post cards now include local save, local list membership, thread open, and a client-side Share action that uses Web Share when available and falls back to copying the Bluesky post URL. Authenticated like/repost/reply/quote writes remain pending.
- Link cards, image/video embeds, alt text affordances, quote posts, and thread previews. Status: improved; Bluesky-provided link-card embeds, image alt badges/viewer alt text, quote posts, thread previews, and video/GIF cards render from loaded AppView data, with native controls for playable video playlists plus thumbnail/open-media fallbacks. Post body text now renders Bluesky rich-text facets (byte-offset aware): inline URLs become clickable external links, @mentions open the mentioned profile in-app, and #hashtags open an in-app post search (wired through a lightweight TagSearchContext so the post-card tree does not need a new callback prop at every call site). Quoted-post body text now uses the same facet renderer, so links/mentions/hashtags inside quote cards are clickable too. External links and link cards should open their target URLs directly, not a right-rail preview panel.

Parity does not mean copying the same layout. The goal is to provide the same functional awareness and navigation options while making the active endless-scroll Feed timeline itself better on desktop.

## Signed-In Menu Inventory

Observed signed-in `bsky.app` menu destinations and what they contain:

- Home: active Feed timeline with feed choices such as Discover, Following, pinned/custom Feeds, inline composer, image attachment shortcut, post cards, replies, reposts, likes, saved-post action, share, post options, right-rail search, More feeds, trending topics, and footer/help links.
- Explore: search for posts/users/Feeds, user interest controls, trending topics with categories/status, Discover new Feeds, suggested Feed cards, Pin feed actions, suggested accounts, and load-more discovery.
- Notifications: All and Mentions tabs, notification settings, follower notifications with Follow back, likes/replies/reposts/mentions, and notification items linked back to users/posts.
- Chat: Requests, chat settings, New chat, inbox state, and message list/empty state. Direct-message content should remain a later/sensitive feature unless the API and privacy posture are clearly handled.
- Feeds: My Feeds, Edit My Feeds, saved/pinned Feed list, Discover New Feeds, search Feeds, community Feed cards, Pin feed actions, liker counts, descriptions, and Feed discovery.
- Lists: list index, New list action, and empty/help state explaining lists as content from favorite people.
- Saved: saved posts timeline, empty state, and Go home action.
- Profile: own profile header, edit profile, more options, follower/following counts, bio/posts count, suggested accounts, profile tabs for Posts, Replies, Media, Videos, Likes, Feeds, Starter Packs, and Lists, plus Write a post.
- Settings: account switch/add account, Account, Privacy and security, Moderation and content filters, Notifications, Content and media, Appearance, Accessibility, Languages, Help, About, and Sign out.

BigBSky should map these menu destinations to desktop-friendly views. The goal is not to duplicate every settings subpage on day one, but the information architecture should leave obvious places for each surface.

## Additional Surface Findings

More detailed signed-in surfaces to account for:

- Feed detail page: a Feed destination has a header with Feed name, creator/handle, like/user count, and Feed options. Below that, it behaves like the active Feed timeline, including the inline composer, image shortcut, post cards, and normal post actions.
- Feed directory page: My Feeds are listed separately from Discover New Feeds. Saved Feeds include direct links and an Edit My Feeds action. Discovery Feed cards include creator, description, liked-by count, and Pin feed action.
- Post/thread page: the thread view shows the original post, author follow control, thread options, reply permissions such as "Everybody can reply", timestamp, repost/quote/like/save counts, links to reposted-by/quotes/liked-by pages, Write your reply composer, and replies below.
- Search results: search has a query field, clear-query action, language selector, and result tabs/filters such as Top, Latest, People, and Feeds. Results can include posts, users, Feeds, videos/GIFs, content labels, hashtags, and media controls.
- Other-user profile: public profiles expose Follow, More options, follower/following counts, external/profile links, suggested related accounts, and profile tabs for Posts, Replies, Media, and Videos. Self-profile additionally includes Edit Profile, Likes, Feeds, Starter Packs, Lists, and Write a post.
- Lists: the list index has New list and an empty/help state when no lists exist. Lists should be treated as another timeline/source type, similar to Feeds but based on selected people rather than topic/community algorithms.
- Media/content labels: post cards and search results can include image alt affordances, video controls, GIF controls, and content labels such as adult/non-sexual nudity warnings with Show/Learn more actions.

These surfaces reinforce the core model: Feed/timeline reading is central, but every destination should preserve the user's place and avoid forcing narrow mobile-style page transitions when desktop space can keep context visible.

## Wide-Screen Design Opportunities

BigBSky should make the active Feed timeline feel native to desktop monitors without turning the default view into a cluttered dashboard.

- Content-first width allocation: extra desktop width belongs to the active Feed timeline and content presentation first. Left and right bars can remain narrow; sidebars should stay compact and useful.
- Wide post cards with structured zones: use extra width for author/meta, content, media, stats, and actions instead of simply stretching post text.
- Media-aware layout: render image/video-heavy posts with larger previews, better side-by-side image grids, clear alt-text affordances, and less wasted vertical scrolling.
- Inline thread expansion: allow a post/thread to expand inline or in an adjacent context area while preserving the active Feed scroll position.
- Feed selector drawer: replace the horizontal top Feed bar with a grouped, searchable Feed selector for pinned Feeds, recent Feeds, Discover, Following, Mentions, topic groups, and Feed search.
- Reading density modes: support Comfortable, Compact, and Media-heavy modes so users can choose between readable full-width cards, faster two-column scanning for rich posts, and visual browsing.
- Sticky active Feed header: show current Feed name, creator, description/count, sort/filter controls, and composer access without consuming too much vertical space.
- Contextual right rail: adapt the right rail to the current Feed or selected post, showing Feed info, related Feeds, trending topics, author previews, thread summaries, or search/discovery.
- Preview side panel: link cards and image details can preview without full navigation. Note (user direction): the right sidebar is for search/feed-suggestions/trending/discovery/secondary context, not for author/profile or thread previews triggered from posts. Authors open via the profile route; threads open by opening the post. Always confirm with the operator before adding anything new to a sidebar.
- Optional multi-column mode: allow power users to pin a second Feed, notifications, or search results beside the active Feed, but do not make multi-column dashboards the default requirement.

The biggest design win is to make the active Feed timeline a desktop reading surface, not a phone-width column surrounded by empty space.

## Novel Desktop Ideas

Useful creative ideas that fit the Feed-first product direction:

- Feed magazine mode: keep the endless Feed, but give media/link-heavy Feeds a more editorial layout with larger lead media, compact text-only posts, and stronger visual grouping. Static path: compute layout in the browser from currently loaded Feed items and local display preferences.
- Per-Feed layout memory: remember layout/density preferences per Feed, such as media-heavy for design/art Feeds, compact for fast rich-post scanning, and comfortable for readable full-width Following. Static path: store browser-locally by Feed URI. Defer cross-device sync.
- Author/profile preview in the right rail: selecting an author can show profile details, follow controls, recent posts, and related Feeds without leaving the active Feed. Static path: fetch live profile and author-feed data on demand, then cache locally.
- Link preview reader: expand Bluesky-provided link-card metadata into a side panel with source, title, thumbnail, description, and source-post actions. Do not crawl third-party pages or summarize related discussion.
- Feed map: show saved/pinned Feeds grouped by topic/community-style categories while still calling them Feeds. Static path: use user-created browser-local groups plus client-side grouping from Feed names/descriptions. Defer shared/global Feed taxonomy.
- Session history trail: keep a small recent trail of viewed Feeds, profiles, posts, and searches so desktop browsing has better wayfinding. Static path: browser-local recent history only.
- Context-preserving profile peek: open profile previews in-place first, with full profile navigation only when the user chooses it. Static path: live API fetch on demand and browser-local cache.

Highest-priority creative ideas:

- Per-Feed layout memory.
- Feed map.

Remove or defer if stateless implementation is not enough:

- Shared Feed maps or public topic taxonomies requiring our backend.
- Engagement labels, topic labels, smart grouping, local scoring, or generated summaries that reinterpret Bluesky posts.
- Cross-device BigBSky preference sync.
- Article extraction/summarization requiring our server to fetch third-party pages.
- Analytics-driven recommendations based on server-side behavior tracking.

