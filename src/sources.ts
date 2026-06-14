import type { Profile } from "./api";

export type FeedSource = {
  id: string;
  label: string;
  uri: string;
  // "Discovered" tags transient sources for dynamically-opened public feeds/
  // lists (discovery/search/at:// routes); it is not a selector group. "Project"
  // is the legacy name for the same thing, kept only so older persisted pinned
  // metadata still validates.
  group: "Core" | "Official" | "Discovered" | "Project" | "My Feeds";
  description: string;
};

export const feedSources: FeedSource[] = [
  {
    id: "discover",
    label: "Discover",
    uri: "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot",
    group: "Core",
    description: "Bluesky's public discovery feed for broad network activity.",
  },
  {
    id: "bluesky-team",
    label: "Bluesky Team",
    uri: "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/bsky-team",
    group: "Official",
    description: "Posts from members of the Bluesky team.",
  },
];

export const navigationItems = [
  "Home",
  "Feeds",
  "Lists",
  "Bookmarks",
  "Search",
  "Explore",
  "Profile",
  "Settings",
  "Info",
];

export function displayName(profile?: Profile) {
  if (!profile) {
    return "Unknown user";
  }

  return profile.displayName?.trim() || profile.handle;
}
