import { feedSources, type FeedSource } from "../../sources";

export const densityModes = ["comfortable", "compact", "media"] as const;
export type DensityMode = (typeof densityModes)[number];

export function feedPreferenceKeys(source: FeedSource) {
  const keys = new Set([`feed:${source.uri}`, `feed:${source.id}`]);
  for (const known of feedSources) {
    if (known.uri === source.uri) {
      keys.add(`feed:${known.id}`);
    }
  }
  return [...keys];
}

export function feedPreferenceKey(source: FeedSource) {
  return `feed:${source.uri}`;
}

export function feedDensityOverride(source: FeedSource, preferences: Record<string, DensityMode>) {
  const value = preferences[feedPreferenceKey(source)];
  return densityModes.includes(value) ? value : undefined;
}

// Per-feed Show Media override: true (always on) / false (always off) / undefined
// (inherit the global Settings preference). Mirrors feedDensityOverride.
export function feedShowMediaOverride(source: FeedSource, preferences: Record<string, boolean>) {
  const value = preferences[feedPreferenceKey(source)];
  return typeof value === "boolean" ? value : undefined;
}

export function FeedDensityOverrideControl({
  source,
  defaultDensity,
  override,
  showMedia,
  onChange,
}: {
  source: FeedSource;
  defaultDensity: DensityMode;
  override?: DensityMode;
  showMedia: boolean;
  onChange: (source: FeedSource, density: DensityMode | null) => void;
}) {
  const effective = override || defaultDensity;
  const mediaPaused = effective === "media" && !showMedia;
  const effectiveLabel = mediaPaused ? "media, paused" : effective;
  return (
    <>
      <label className="feed-density-control">
        <span>View</span>
        <select
          value={override || "default"}
          onChange={(event) => {
            const value = event.target.value;
            onChange(source, value === "default" ? null : (value as DensityMode));
          }}
        >
          <option value="default">Default ({effectiveLabel})</option>
          {densityModes.map((mode) => (
            <option value={mode} key={mode} disabled={mode === "media" && !showMedia}>
              {mode}
            </option>
          ))}
        </select>
      </label>
      {mediaPaused && (
        <p className="feed-media-warning">Media view paused — turn Media on for this feed.</p>
      )}
    </>
  );
}

export function FeedShowMediaOverrideControl({
  source,
  defaultShowMedia,
  override,
  onChange,
}: {
  source: FeedSource;
  defaultShowMedia: boolean;
  override?: boolean;
  onChange: (source: FeedSource, value: boolean | null) => void;
}) {
  const value = override === undefined ? "default" : override ? "on" : "off";
  const defaultLabel = defaultShowMedia ? "on" : "off";
  return (
    <label className="feed-density-control">
      <span>Media</span>
      <select
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          onChange(source, next === "default" ? null : next === "on");
        }}
      >
        <option value="default">Default ({defaultLabel})</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
    </label>
  );
}
