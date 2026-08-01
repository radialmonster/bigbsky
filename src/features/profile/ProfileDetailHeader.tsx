import { useEffect, useState } from "react";
import type { Profile } from "../../api";
import { displayName } from "../../sources";
import { Avatar } from "../common/Avatar";
import { useResetTimeout } from "../common/useResetTimeout";

export const profileTabs = ["posts", "replies", "media", "videos", "feeds", "lists"] as const;
export type ProfileTab = (typeof profileTabs)[number] | "new-post";

export function ProfileDetailHeader({
  actor,
  isPinned,
  profile,
  selectedTab,
  onSelectTab,
  onTogglePinned,
  canFollow,
  onFollow,
  onUnfollow,
  onBlock,
  onUnblock,
  canPost,
}: {
  actor: string;
  isPinned: boolean;
  profile: Profile | null;
  selectedTab: ProfileTab;
  onSelectTab: (tab: ProfileTab) => void;
  onTogglePinned: (profile: Profile | null | undefined) => void;
  canFollow: boolean;
  onFollow: (did: string) => Promise<string>;
  onUnfollow: (followUri: string) => Promise<void>;
  onBlock: (did: string) => Promise<string>;
  onUnblock: (blockUri: string) => Promise<void>;
  canPost: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const scheduleReset = useResetTimeout();
  // Follow state is seeded from the authenticated profile's viewer.following
  // record URI and re-synced when the viewed profile changes.
  const [followUri, setFollowUri] = useState<string | undefined>(profile?.viewer?.following);
  const [followBusy, setFollowBusy] = useState(false);
  // Block state is seeded from the authenticated profile's viewer.blocking
  // record URI and re-synced when the viewed profile changes.
  const [blockUri, setBlockUri] = useState<string | undefined>(profile?.viewer?.blocking);
  const [blockBusy, setBlockBusy] = useState(false);
  useEffect(() => {
    setFollowUri(profile?.viewer?.following);
    setBlockUri(profile?.viewer?.blocking);
  }, [profile?.did, profile?.viewer?.following, profile?.viewer?.blocking]);

  async function handleToggleFollow() {
    if (!profile || followBusy) {
      return;
    }
    const previous = followUri;
    setFollowBusy(true);
    try {
      if (previous) {
        setFollowUri(undefined); // optimistic
        await onUnfollow(previous);
      } else {
        setFollowUri("pending"); // optimistic placeholder
        const uri = await onFollow(profile.did);
        setFollowUri(uri);
      }
    } catch {
      setFollowUri(previous); // revert on error
    } finally {
      setFollowBusy(false);
    }
  }

  async function handleToggleBlock() {
    if (!profile || blockBusy) {
      return;
    }
    // Blocking is destructive (it also removes any follow relationship server-
    // side); confirm before creating the block record.
    if (!blockUri && !window.confirm(`Block @${profile.handle}? They won't be able to see or reply to your posts, and this also undoes any follow.`)) {
      return;
    }
    const previous = blockUri;
    setBlockBusy(true);
    try {
      if (previous) {
        setBlockUri(undefined); // optimistic
        await onUnblock(previous);
      } else {
        setBlockUri("pending"); // optimistic placeholder
        const uri = await onBlock(profile.did);
        setBlockUri(uri);
        // A block clears the follow relationship server-side; reflect that.
        setFollowUri(undefined);
      }
    } catch {
      setBlockUri(previous); // revert on error
    } finally {
      setBlockBusy(false);
    }
  }

  const bskyUrl = `https://bsky.app/profile/${encodeURIComponent(profile?.handle || actor)}`;
  const visibleTabs: ProfileTab[] = canPost ? ["new-post", ...profileTabs] : [...profileTabs];

  return (
    <section className="profile-detail-header">
      <div className="profile-banner" />
      <div className="profile-detail-main">
        <Avatar profile={profile ?? undefined} />
        <div>
          <span>Public Profile</span>
          <h2>{displayName(profile ?? undefined)}</h2>
          <p>@{profile?.handle || actor}</p>
        </div>
        <div className="profile-detail-actions">
          {canFollow && !blockUri && (
            <button
              type="button"
              className={followUri ? "following" : "follow"}
              onClick={handleToggleFollow}
              disabled={followBusy || !profile}
              title={followUri ? "Unfollow this account" : "Follow this account"}
            >
              {followBusy ? "…" : followUri ? "Following" : "Follow"}
            </button>
          )}
          {canFollow && (
            <button
              type="button"
              className={blockUri ? "blocking" : "block"}
              onClick={handleToggleBlock}
              disabled={blockBusy || !profile}
              title={blockUri ? "Unblock this account" : "Block this account"}
            >
              {blockBusy ? "…" : blockUri ? "Blocking" : "Block"}
            </button>
          )}
          <button type="button" onClick={() => onTogglePinned(profile)} disabled={!profile}>
            {isPinned ? "Unpin profile" : "Pin locally"}
          </button>
          <button
            type="button"
            onClick={() => {
              const write = navigator.clipboard?.writeText(bskyUrl);
              if (!write) {
                return;
              }
              void write
                .then(() => {
                  setCopied(true);
                  scheduleReset(() => setCopied(false), 1600);
                })
                .catch(() => {
                  // Clipboard blocked (insecure context / denied / no gesture) —
                  // don't falsely report "Copied".
                });
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <a href={bskyUrl} target="_blank" rel="noreferrer">
            Open on Bluesky
          </a>
        </div>
      </div>
      {profile?.description && <p className="profile-detail-description">{profile.description}</p>}
      <dl className="profile-detail-stats">
        <div>
          <dt>Followers</dt>
          <dd>{profile?.followersCount?.toLocaleString() ?? "-"}</dd>
        </div>
        <div>
          <dt>Following</dt>
          <dd>{profile?.followsCount?.toLocaleString() ?? "-"}</dd>
        </div>
        <div>
          <dt>Posts</dt>
          <dd>{profile?.postsCount?.toLocaleString() ?? "-"}</dd>
        </div>
      </dl>
      <div className="profile-tabs" aria-label="Profile tabs">
        {visibleTabs.map((tab) => (
          <button className={selectedTab === tab ? "selected" : ""} key={tab} type="button" onClick={() => onSelectTab(tab)}>
            {tab === "new-post" ? "New post" : tab}
          </button>
        ))}
      </div>
    </section>
  );
}
