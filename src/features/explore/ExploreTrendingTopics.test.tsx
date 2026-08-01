import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTrendingTopics: vi.fn(),
}));

vi.mock("../../api", () => ({
  getTrendingTopics: (limit: number, signal?: AbortSignal) => mocks.getTrendingTopics(limit, signal),
}));

import { ExploreTrendingTopics } from "./ExploreTrendingTopics";

describe("ExploreTrendingTopics", () => {
  beforeEach(() => {
    mocks.getTrendingTopics.mockReset();
  });

  it("renders a loading state while the live fetch is in flight", () => {
    mocks.getTrendingTopics.mockReturnValue(new Promise(() => {}));
    render(<ExploreTrendingTopics onOpenSearchQuery={vi.fn()} />);
    expect(screen.getByText("Loading trending topics")).toBeTruthy();
  });

  it("renders live topics and opens them as in-app searches", async () => {
    mocks.getTrendingTopics.mockResolvedValue({
      topics: [{ topic: "#atproto", link: "https://bsky.app/hashtag/atproto", description: "Protocol" }],
      suggested: [{ topic: "#bluesky", link: "https://bsky.app/hashtag/bluesky" }],
    });
    const onOpenSearchQuery = vi.fn();
    render(<ExploreTrendingTopics onOpenSearchQuery={onOpenSearchQuery} />);
    await waitFor(() => expect(screen.getByText("#atproto")).toBeTruthy());
    expect(screen.getByTitle("Protocol")).toBeTruthy();
    expect(screen.getByText("#bluesky")).toBeTruthy();
    fireEvent.click(screen.getByText("#atproto"));
    expect(onOpenSearchQuery).toHaveBeenCalledWith("#atproto");
  });

  it("renders an error state when the live fetch fails", async () => {
    mocks.getTrendingTopics.mockRejectedValue(new Error("rate limited"));
    render(<ExploreTrendingTopics onOpenSearchQuery={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("Trending topics could not be loaded right now.")).toBeTruthy(),
    );
  });

  it("renders nothing when the live fetch returns no topics", async () => {
    mocks.getTrendingTopics.mockResolvedValue({ topics: [], suggested: [] });
    const { container } = render(<ExploreTrendingTopics onOpenSearchQuery={vi.fn()} />);
    await waitFor(() => expect(container.querySelector(".trending-topics")).toBeNull());
  });
});
