import type { Profile } from "./api";

export type FeedSource = {
  id: string;
  label: string;
  actor: string;
  group: "Core" | "People" | "Project";
  description: string;
};

export const feedSources: FeedSource[] = [
  {
    id: "bsky",
    label: "Bluesky",
    actor: "bsky.app",
    group: "Core",
    description: "Official Bluesky account feed for public API smoke testing.",
  },
  {
    id: "atproto",
    label: "AT Protocol",
    actor: "atproto.com",
    group: "Core",
    description: "Protocol updates and AT ecosystem posts.",
  },
  {
    id: "jay",
    label: "Jay at Bluesky",
    actor: "jay.bsky.team",
    group: "People",
    description: "Public demo profile feed used until OAuth and user-pinned feeds are added.",
  },
  {
    id: "bigbsky",
    label: "BigBSky Route Test",
    actor: "bsky.app",
    group: "Project",
    description: "Placeholder source for validating shell state and deployment.",
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
