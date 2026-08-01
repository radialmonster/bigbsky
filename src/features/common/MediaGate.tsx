import { EyeOff, Film, Image } from "lucide-react";
import { moderationLabelText } from "../../lib/moderation";

export function SensitiveMediaGate({ values, onReveal }: { values: string[]; onReveal: () => void }) {
  return (
    <button type="button" className="sensitive-media-gate" onClick={onReveal}>
      <EyeOff size={18} />
      <strong>Sensitive content</strong>
      <small>{values.map((value) => moderationLabelText({ val: value })).join(", ")}</small>
      <span className="sensitive-media-show">Show</span>
    </button>
  );
}

// Shown in place of images/video when the "Show Media" setting is off. Clicking
// reveals the media for that one card without changing the global setting.
export function MediaHiddenButton({ kind, onReveal, revealed = false }: { kind: "image" | "video"; onReveal: () => void; revealed?: boolean }) {
  const label = revealed ? "Hide Media" : "Reveal Media";
  return (
    <button
      type="button"
      className="media-hidden-button"
      onClick={onReveal}
      title={revealed ? `Hide ${kind}` : `Show ${kind}`}
      aria-label={revealed ? `Hide ${kind}` : `Show hidden ${kind}`}
    >
      {kind === "video" ? <Film size={16} /> : <Image size={16} />}
      <span>{label}</span>
    </button>
  );
}
