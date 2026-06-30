// Pure pinned-feed-metadata validator extracted from src/App.tsx (decomposition
// slice 4).
//
// Discovered/opened feed generators and lists can be pinned to the feed
// selector; their metadata (so they can be rendered without a refetch) is
// persisted browser-local under `pinnedFeedMetaStorageKey`. Because that store
// is arbitrary JSON the user's browser may have written across app versions, it
// is validated entry-by-entry on read (`readPinnedFeedMeta` filters with this
// guard) so a malformed or partial record can never reach the feed selector.
//
// Behavior preserved verbatim from the previous inline `isPinnedFeedMeta`:
//   - The value must be a non-null object.
//   - `id` must be a string beginning with "at://" (only at:// feed/list URIs
//     are pinnable as discovered metadata; built-in sources have their own ids).
//   - `uri`, `label`, and `description` must all be strings.
//   - `group` must be one of the persisted discovered groups. "Project" is the
//     legacy alias for "Discovered", kept so older pins still validate.

import type { FeedSource } from "../sources";

export function isPinnedFeedMeta(value: unknown): value is FeedSource {
  if (!value || typeof value !== "object") {
    return false;
  }
  const source = value as Partial<FeedSource>;
  return (
    typeof source.id === "string" &&
    source.id.startsWith("at://") &&
    typeof source.uri === "string" &&
    typeof source.label === "string" &&
    typeof source.description === "string" &&
    (source.group === "Core" ||
      source.group === "Official" ||
      source.group === "Discovered" ||
      source.group === "Project") // legacy alias for Discovered; kept so older pins still load
  );
}
