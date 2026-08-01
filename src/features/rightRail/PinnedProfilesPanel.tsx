import { X } from "lucide-react";
import type { Profile } from "../../api";
import { displayName } from "../../sources";
import { Avatar } from "../common/Avatar";

export function PinnedProfilesPanel({
  profiles,
  onOpen,
  onToggle,
}: {
  profiles: Profile[];
  onOpen: (profile: Profile) => void;
  onToggle: (profile: Profile) => void;
}) {
  if (profiles.length === 0) {
    return null;
  }

  return (
    <section className="context-panel pinned-profiles-panel">
      <h2>Pinned Profiles</h2>
      {profiles.map((profile) => (
        <div key={profile.did}>
          <button type="button" onClick={() => onOpen(profile)}>
            <Avatar profile={profile} />
            <span>
              <strong>{displayName(profile)}</strong>
              <small>@{profile.handle}</small>
            </span>
          </button>
          <button type="button" onClick={() => onToggle(profile)} aria-label={`Unpin @${profile.handle}`}>
            <X size={13} />
          </button>
        </div>
      ))}
    </section>
  );
}
