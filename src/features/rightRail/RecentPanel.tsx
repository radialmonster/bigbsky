import type { RouteState } from "../../router";

export type RecentItem = {
  label: string;
  path: string;
  route: RouteState;
  detail: string;
  sourceId?: string;
};

export function RecentPanel({
  items,
  onOpen,
  onClear,
}: {
  items: RecentItem[];
  onOpen: (item: RecentItem) => void;
  onClear: () => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="context-panel recent-panel">
      <div className="context-panel-header">
        <h2>Recent</h2>
        <button type="button" className="panel-clear" onClick={onClear} aria-label="Clear recent trail" title="Clear recent">
          Clear
        </button>
      </div>
      {items.map((item) => (
        <button key={item.path} type="button" onClick={() => onOpen(item)}>
          <span>{item.label}</span>
          <small>{item.detail}</small>
        </button>
      ))}
    </section>
  );
}
