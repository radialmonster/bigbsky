import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTrendingTopics: vi.fn(),
}));

vi.mock("../../api", () => ({
  getTrendingTopics: (limit: number, signal?: AbortSignal) => mocks.getTrendingTopics(limit, signal),
}));

import { TrendingPanel } from "./TrendingPanel";

const fallback = [
  { tag: "#atproto", count: 120 },
  { tag: "#bluesky", count: 90 },
];

describe("TrendingPanel", () => {
  it("renders the loaded-post fallback topics when the live fetch fails or is empty", async () => {
    mocks.getTrendingTopics.mockRejectedValue(new Error("rate limited"));
    render(<TrendingPanel fallback={fallback} onOpenTopic={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Trending" })).toBeTruthy();
    expect(screen.getByText("#atproto")).toBeTruthy();
    expect(screen.getByText("120")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText("Live trending is unavailable right now - showing saved defaults.")).toBeTruthy(),
    );
  });

  it("renders static default topics when there is no fallback", () => {
    mocks.getTrendingTopics.mockRejectedValue(new Error("rate limited"));
    render(<TrendingPanel fallback={[]} onOpenTopic={vi.fn()} />);
    expect(screen.getByText("#atproto")).toBeTruthy();
    expect(screen.getByText("#bluesky")).toBeTruthy();
    expect(screen.getByText("#socialweb")).toBeTruthy();
  });

  it("opens an in-app search when a topic is clicked", () => {
    mocks.getTrendingTopics.mockRejectedValue(new Error("rate limited"));
    const onOpenTopic = vi.fn();
    render(<TrendingPanel fallback={fallback} onOpenTopic={onOpenTopic} />);
    fireEvent.click(screen.getByText("#bluesky"));
    expect(onOpenTopic).toHaveBeenCalledWith("#bluesky");
  });

  it("renders live topics when the fetch succeeds", async () => {
    mocks.getTrendingTopics.mockResolvedValue({
      topics: [
        { topic: "#live", link: "https://bsky.app/hashtag/live", description: "Live now" },
        { topic: "#two", link: "https://bsky.app/hashtag/two" },
      ],
      suggested: [],
    });
    render(<TrendingPanel fallback={fallback} onOpenTopic={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("#live")).toBeTruthy());
    expect(screen.getByText("Live now")).toBeTruthy();
    expect(screen.queryByText("#atproto")).toBeNull();
  });
});
