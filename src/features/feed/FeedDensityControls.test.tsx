import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { feedSources, type FeedSource } from "../../sources";
import {
  FeedDensityOverrideControl,
  FeedShowMediaOverrideControl,
  densityModes,
  feedDensityOverride,
  feedPreferenceKey,
  feedPreferenceKeys,
  feedShowMediaOverride,
  type DensityMode,
} from "./FeedDensityControls";

const source: FeedSource = {
  id: "feed1",
  uri: "at://did:example:feed1",
  label: "Feed 1",
  group: "My Feeds",
  description: "A test feed.",
};

describe("feedPreferenceKey / feedPreferenceKeys", () => {
  it("keys a feed by its uri", () => {
    expect(feedPreferenceKey(source)).toBe("feed:at://did:example:feed1");
  });

  it("includes the id alias and known-feed id aliases for the same uri", () => {
    const keys = feedPreferenceKeys(source);
    expect(keys).toContain("feed:at://did:example:feed1");
    expect(keys).toContain("feed:feed1");
  });

  it("adds the built-in id alias when the source uri matches a known feed", () => {
    const known = feedSources[0];
    const sameUri = { ...source, id: "renamed", uri: known.uri };
    const keys = feedPreferenceKeys(sameUri);
    expect(keys).toContain(`feed:${known.uri}`);
    expect(keys).toContain("feed:renamed");
    expect(keys).toContain(`feed:${known.id}`);
  });
});

describe("feedDensityOverride", () => {
  it("returns undefined when no per-feed preference is stored", () => {
    expect(feedDensityOverride(source, {})).toBeUndefined();
  });

  it("returns the stored density when valid", () => {
    expect(feedDensityOverride(source, { "feed:at://did:example:feed1": "compact" })).toBe("compact");
  });

  it("ignores an invalid stored value", () => {
    expect(feedDensityOverride(source, { "feed:at://did:example:feed1": "dense" as DensityMode })).toBeUndefined();
  });
});

describe("feedShowMediaOverride", () => {
  it("returns undefined when no per-feed preference is stored", () => {
    expect(feedShowMediaOverride(source, {})).toBeUndefined();
  });

  it("returns the stored boolean on/off value", () => {
    expect(feedShowMediaOverride(source, { "feed:at://did:example:feed1": false })).toBe(false);
    expect(feedShowMediaOverride(source, { "feed:at://did:example:feed1": true })).toBe(true);
  });

  it("ignores a non-boolean stored value", () => {
    expect(feedShowMediaOverride(source, { "feed:at://did:example:feed1": "yes" as unknown as boolean })).toBeUndefined();
  });
});

describe("FeedDensityOverrideControl", () => {
  it("shows the effective default when no override is set", () => {
    render(<FeedDensityOverrideControl source={source} defaultDensity="comfortable" showMedia onChange={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Default (comfortable)" })).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("default");
  });

  it("reports the chosen density as an override via onChange", () => {
    const onChange = vi.fn();
    render(<FeedDensityOverrideControl source={source} defaultDensity="comfortable" showMedia onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "compact" } });
    expect(onChange).toHaveBeenCalledWith(source, "compact");
  });

  it("clears an override back to the default via onChange(null)", () => {
    const onChange = vi.fn();
    render(<FeedDensityOverrideControl source={source} defaultDensity="compact" override="comfortable" showMedia onChange={onChange} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("comfortable");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "default" } });
    expect(onChange).toHaveBeenCalledWith(source, null);
  });

  it("disables the media option and warns when media view is paused for the feed", () => {
    render(<FeedDensityOverrideControl source={source} defaultDensity="media" showMedia={false} onChange={vi.fn()} />);
    const mediaOption = screen.getByRole("option", { name: "media" });
    expect(mediaOption).toHaveProperty("disabled", true);
    expect(screen.getByText("Default (media, paused)")).toBeTruthy();
    expect(screen.getByText(/Media view paused/)).toBeTruthy();
  });

  it("offers all density modes as selectable options", () => {
    render(<FeedDensityOverrideControl source={source} defaultDensity="comfortable" showMedia onChange={vi.fn()} />);
    for (const mode of densityModes) {
      expect(screen.getByRole("option", { name: mode })).toBeTruthy();
    }
  });

  it("types DensityMode from the exported union", () => {
    const check: DensityMode = "compact";
    expect(["comfortable", "compact", "media"]).toContain(check);
  });
});

describe("FeedShowMediaOverrideControl", () => {
  it("shows the default media label when no override is set", () => {
    render(<FeedShowMediaOverrideControl source={source} defaultShowMedia onChange={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Default (on)" })).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("default");
  });

  it("reflects an explicit on/off override", () => {
    const { rerender } = render(<FeedShowMediaOverrideControl source={source} defaultShowMedia override={false} onChange={vi.fn()} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("off");
    rerender(<FeedShowMediaOverrideControl source={source} defaultShowMedia override onChange={vi.fn()} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("on");
  });

  it("reports on/off selections and clears back to default", () => {
    const onChange = vi.fn();
    render(<FeedShowMediaOverrideControl source={source} defaultShowMedia={false} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "on" } });
    expect(onChange).toHaveBeenCalledWith(source, true);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "off" } });
    expect(onChange).toHaveBeenCalledWith(source, false);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "default" } });
    expect(onChange).toHaveBeenCalledWith(source, null);
  });
});
