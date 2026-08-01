import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback } from "react";

import { useCursorPaged } from "./useCursorPaged";

const mocks = vi.hoisted(() => ({
  isRateLimit: vi.fn(),
  rateLimitMessage: vi.fn(),
}));

vi.mock("../../api", () => ({
  isRateLimit: mocks.isRateLimit,
  rateLimitMessage: mocks.rateLimitMessage,
}));

type LoadPage = (
  actor: string,
  cursor?: string,
  signal?: AbortSignal,
) => Promise<{ items: string[]; cursor?: string }>;

function Harness({ actor, onLoad }: { actor: string; onLoad: LoadPage }) {
  const loadPage = useCallback(
    (cursor?: string, signal?: AbortSignal) => onLoad(actor, cursor, signal),
    [actor, onLoad],
  );
  const { state, loadMore, reset } = useCursorPaged<string>(loadPage);
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="items">{state.items.join(",")}</span>
      <span data-testid="cursor">{state.cursor ?? "none"}</span>
      <span data-testid="error">{state.error ?? "none"}</span>
      <span data-testid="loadMoreError">{state.loadMoreError ?? "none"}</span>
      <button type="button" onClick={loadMore}>
        more
      </button>
      <button type="button" onClick={reset}>
        reset
      </button>
    </div>
  );
}

describe("useCursorPaged", () => {
  beforeEach(() => {
    mocks.isRateLimit.mockReset();
    mocks.rateLimitMessage.mockReset();
  });

  it("loads the first page on mount", async () => {
    const onLoad = vi.fn(async () => ({ items: ["a", "b"], cursor: "c1" }));
    render(<Harness actor="u1" onLoad={onLoad} />);
    expect(screen.getByTestId("status").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    expect(screen.getByTestId("items").textContent).toBe("a,b");
    expect(screen.getByTestId("cursor").textContent).toBe("c1");
    expect(screen.getByTestId("error").textContent).toBe("none");
  });

  it("loadMore appends the next page and advances the cursor", async () => {
    const onLoad = vi.fn(async (_actor, cursor) =>
      cursor === "c1" ? { items: ["c"], cursor: "c2" } : { items: ["a", "b"], cursor: "c1" },
    );
    render(<Harness actor="u1" onLoad={onLoad} />);
    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("a,b"));
    fireEvent.click(screen.getByText("more"));
    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("a,b,c"));
    expect(screen.getByTestId("cursor").textContent).toBe("c2");
  });

  it("surfaces an error state with the classified message when the first page fails", async () => {
    mocks.isRateLimit.mockReturnValue(false);
    mocks.rateLimitMessage.mockReturnValue("boom");
    const onLoad = vi.fn(async () => {
      throw new Error("boom");
    });
    render(<Harness actor="u1" onLoad={onLoad} />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    expect(screen.getByTestId("error").textContent).toBe("boom");
    expect(screen.getByTestId("items").textContent).toBe("");
  });

  it("maps a rate-limited first page to the rate-limit status", async () => {
    mocks.isRateLimit.mockReturnValue(true);
    const onLoad = vi.fn(async () => {
      throw new Error("rate limited");
    });
    render(<Harness actor="u1" onLoad={onLoad} />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("rate-limit"));
  });

  it("keeps loaded items and the cursor when load-more fails, then recovers", async () => {
    const onLoad = vi.fn(async (_actor, cursor) => {
      if (cursor === "c1") {
        throw new Error("network");
      }
      return { items: ["a", "b"], cursor: "c1" };
    });
    mocks.isRateLimit.mockReturnValue(false);
    render(<Harness actor="u1" onLoad={onLoad} />);
    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("a,b"));
    fireEvent.click(screen.getByText("more"));
    await waitFor(() =>
      expect(screen.getByTestId("loadMoreError").textContent).toBe("Couldn't load more right now."),
    );
    expect(screen.getByTestId("items").textContent).toBe("a,b");
    expect(screen.getByTestId("cursor").textContent).toBe("c1");

    onLoad.mockImplementation(async (_actor, cursor) =>
      cursor === "c1" ? { items: ["c"], cursor: "c2" } : { items: ["a", "b"], cursor: "c1" },
    );
    fireEvent.click(screen.getByText("more"));
    await waitFor(() => expect(screen.getByTestId("loadMoreError").textContent).toBe("none"));
    expect(screen.getByTestId("items").textContent).toBe("a,b,c");
  });

  it("reset() refetches the first page", async () => {
    const onLoad = vi.fn(async () => ({ items: ["a", "b"], cursor: "c1" }));
    render(<Harness actor="u1" onLoad={onLoad} />);
    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("a,b"));
    fireEvent.click(screen.getByText("more"));
    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("a,b,a,b"));
    fireEvent.click(screen.getByText("reset"));
    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("a,b"));
    expect(onLoad).toHaveBeenCalledTimes(3);
  });

  it("refetches when the loadPage identity changes (e.g. an actor change)", async () => {
    const onLoad = vi.fn(async (actor) => ({ items: [actor], cursor: undefined }));
    const { rerender } = render(<Harness actor="u1" onLoad={onLoad} />);
    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("u1"));
    rerender(<Harness actor="u2" onLoad={onLoad} />);
    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("u2"));
    expect(onLoad).toHaveBeenCalledTimes(2);
  });
});
