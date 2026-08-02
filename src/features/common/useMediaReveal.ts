import { createContext, useContext, useState } from "react";

// Browser-local NSFW preference; false (hide/warn) by default for everyone.
// Read by post cards to decide whether adult/graphic media is gated.
export const ShowNsfwContext = createContext<boolean>(false);

// Read by post cards to decide whether to render images/video at all. When
// off, media is replaced by a click-to-reveal affordance (text still shows).
export const ShowMediaContext = createContext<boolean>(true);

export function useMediaReveal({
  sensitiveWarningCount,
  hasMedia,
  hasThumbnail,
}: {
  sensitiveWarningCount: number;
  hasMedia: boolean;
  hasThumbnail: boolean;
}) {
  const showNsfw = useContext(ShowNsfwContext);
  const showMedia = useContext(ShowMediaContext);
  const [revealed, setRevealed] = useState(false);
  // Sensitive-content gate takes precedence over the show-media hide: once a
  // post is revealed past the NSFW gate, the show-media setting still applies.
  const gate = !showNsfw && sensitiveWarningCount > 0 && hasMedia && !revealed;
  const hidden = !showMedia && !revealed && !gate;
  const thumbnailHidden = !showMedia && !revealed && hasThumbnail;
  return { revealed, setRevealed, gate, hidden, thumbnailHidden };
}
