// Pure feed-ordering helper extracted from src/App.tsx (decomposition slice 3).
//
// Browser-local manual ordering of the signed-in user's saved feeds, stored as
// a list of feed URIs (see `readFeedOrder` / `feedOrderStorageKey`). The saved
// order is applied to the live subscribed-feeds list for both the /feeds "Your
// feeds" grid and the desktop feed-selector "My Feeds" group.
//
// Behavior preserved verbatim from the previous inline `orderedSubscribedFeeds`
// useMemo:
//   - An empty `order` returns the input array unchanged (same reference).
//   - Feeds present in `order` sort by their position in `order`.
//   - Feeds NOT present in `order` (newly subscribed since the last manual
//     reorder) fall back to the end, after every ranked feed, keeping their
//     original relative order (Array.prototype.sort is stable).
//   - A URI listed in `order` but not currently subscribed is simply ignored.

export function orderBySavedOrder<T extends { uri: string }>(feeds: readonly T[], order: readonly string[]): T[] {
  if (order.length === 0) {
    // Preserve the original reference (the useMemo returned `subscribedFeeds`
    // directly) so callers that depend on identity stability are unaffected.
    return feeds as T[];
  }
  const rank = new Map(order.map((uri, index) => [uri, index]));
  const fallback = order.length;
  return [...feeds].sort((a, b) => (rank.get(a.uri) ?? fallback) - (rank.get(b.uri) ?? fallback));
}
