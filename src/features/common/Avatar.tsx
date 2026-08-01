import type { Profile } from "../../api";

export function Avatar({ profile }: { profile?: Profile }) {
  return profile?.avatar ? <img className="avatar" src={profile.avatar} alt="" loading="lazy" /> : <span className="avatar fallback" />;
}
