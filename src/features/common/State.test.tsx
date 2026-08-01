import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState, EndOfFeedCard, ErrorState, LoadingState, RateLimitState } from "./State";

describe("LoadingState", () => {
  it("renders the loading label", () => {
    render(<LoadingState label="Loading posts" />);
    expect(screen.getByText("Loading posts")).toBeTruthy();
  });
});

describe("ErrorState", () => {
  it("renders the fixed failure heading and the message", () => {
    render(<ErrorState message="Rate limited" />);
    expect(screen.getByText("Unable to load")).toBeTruthy();
    expect(screen.getByText("Rate limited")).toBeTruthy();
  });
});

describe("RateLimitState", () => {
  it("renders the rate-limit heading and the provided message", () => {
    render(<RateLimitState message="Slow down" />);
    expect(screen.getByText("Rate limit reached")).toBeTruthy();
    expect(screen.getByText("Slow down")).toBeTruthy();
  });

  it("falls back to the generic throttle copy when no message is given", () => {
    render(<RateLimitState />);
    expect(screen.getByText("Rate limit reached")).toBeTruthy();
    expect(screen.getByText(/Bluesky is throttling this public API request/)).toBeTruthy();
  });
});

describe("EmptyState", () => {
  it("renders the title and message", () => {
    render(<EmptyState title="No posts" message="Nothing here yet." />);
    expect(screen.getByText("No posts")).toBeTruthy();
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
  });
});

describe("EndOfFeedCard", () => {
  it("defaults to the posts copy and announces as status", () => {
    render(<EndOfFeedCard />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("End of Feed")).toBeTruthy();
    expect(screen.getByText(/No more posts can be returned/)).toBeTruthy();
  });

  it("uses the media copy for the media kind", () => {
    render(<EndOfFeedCard kind="media" />);
    expect(screen.getByText(/No more media posts can be returned/)).toBeTruthy();
  });
});
