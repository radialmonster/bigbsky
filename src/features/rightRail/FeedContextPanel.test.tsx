import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FeedSource } from "../../sources";
import { FeedContextPanel } from "./FeedContextPanel";

const source: FeedSource = {
  id: "at://did:plc:feed1/app.bsky.feed.generator/feed1",
  uri: "at://did:plc:feed1/app.bsky.feed.generator/feed1",
  label: "The Feed",
  group: "Core",
  description: "A public feed",
};

const entityCache = { posts: { p1: {} as never, p2: {} as never }, profiles: {}, linkUrls: [] };

describe("FeedContextPanel", () => {
  it("renders feed metadata, stats, and actions", () => {
    const metadata = {
      uri: source.uri,
      creator: { did: "did:plc:feed1", handle: "feed1.test" },
      displayName: "The Feed",
      description: "A public feed",
      likeCount: 123,
    } as never;
    render(
      <FeedContextPanel
        source={source}
        metadata={metadata}
        listMetadata={null}
        entityCache={entityCache}
        isPinned={false}
        onTogglePinned={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "The Feed" })).toBeTruthy();
    expect(screen.getByText("A public feed")).toBeTruthy();
    expect(screen.getByText("@feed1.test")).toBeTruthy();
    expect(screen.getByText("123")).toBeTruthy();
    expect(screen.getByText("Pin feed")).toBeTruthy();
    expect(screen.getByText("Copy URI")).toBeTruthy();
  });

  it("shows the unpin action when the feed is pinned", () => {
    render(
      <FeedContextPanel
        source={source}
        metadata={null}
        listMetadata={null}
        entityCache={entityCache}
        isPinned
        onTogglePinned={vi.fn()}
      />,
    );
    expect(screen.getByText("Unpin feed")).toBeTruthy();
  });

  it("labels list sources as Lists and opens their Bluesky URL on the lists path", () => {
    const listSource: FeedSource = {
      id: "at://did:plc:list1/app.bsky.graph.list/list1",
      uri: "at://did:plc:list1/app.bsky.graph.list/list1",
      label: "My List",
      group: "Core",
      description: "A list",
    };
    const listMetadata = {
      uri: listSource.uri,
      name: "My List",
      listItemCount: 7,
      creator: { did: "did:plc:list1", handle: "list1.test" },
    } as never;
    render(
      <FeedContextPanel
        source={listSource}
        metadata={null}
        listMetadata={listMetadata}
        entityCache={entityCache}
        isPinned={false}
        onTogglePinned={vi.fn()}
      />,
    );
    expect(screen.getByText("List")).toBeTruthy();
    expect(screen.getByText("Pin list")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    const external = screen.getByRole("link", { name: "Open on Bluesky" });
    expect(external.getAttribute("href")).toContain("/lists/list1");
  });

  it("copies the source URI and shows a transient confirmation", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <FeedContextPanel
        source={source}
        metadata={null}
        listMetadata={null}
        entityCache={entityCache}
        isPinned={false}
        onTogglePinned={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Copy URI"));
    expect(writeText).toHaveBeenCalledWith(source.uri);
  });
});
