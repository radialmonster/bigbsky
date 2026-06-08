import type { Profile } from "./api";

export type FeedSource = {
  id: string;
  label: string;
  uri: string;
  group: "Core" | "Media" | "Project";
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
    id: "popular-with-friends",
    label: "Popular With Friends",
    uri: "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/with-friends",
    group: "Core",
    description: "A Bluesky feed-generator source for popular posts and likes.",
  },
  {
    id: "video",
    label: "Video",
    uri: "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/thevids",
    group: "Media",
    description: "Trending videos in the public Bluesky network.",
  },
  {
    id: "bigbsky",
    label: "BigBSky Route Test",
    uri: "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot",
    group: "Project",
    description: "Project placeholder using the public Discover feed while app-specific feeds are deferred.",
  },
];

export const navigationItems = [
  "Home",
  "Explore",
  "Notifications",
  "Chat",
  "Feeds",
  "Lists",
  "Saved",
  "Profile",
  "Settings",
];

export function displayName(profile?: Profile) {
  if (!profile) {
    return "Unknown user";
  }

  return profile.displayName?.trim() || profile.handle;
}
