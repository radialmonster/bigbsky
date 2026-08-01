import { X } from "lucide-react";

export function PinnedSearchesPanel({
  searches,
  onOpen,
  onToggle,
}: {
  searches: string[];
  onOpen: (query: string) => void;
  onToggle: (query: string) => void;
}) {
  if (searches.length === 0) {
    return null;
  }

  return (
    <section className="context-panel pinned-searches-panel">
      <h2>Pinned Searches</h2>
      {searches.map((query) => (
        <div key={query}>
          <button type="button" onClick={() => onOpen(query)}>
            {query}
          </button>
          <button type="button" onClick={() => onToggle(query)} aria-label={`Unpin ${query}`}>
            <X size={13} />
          </button>
        </div>
      ))}
    </section>
  );
}
