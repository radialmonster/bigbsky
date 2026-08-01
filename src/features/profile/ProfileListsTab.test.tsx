import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListView } from "../../api";

const mocks = vi.hoisted(() => ({
  getActorLists: vi.fn(),
  isRateLimit: vi.fn(),
  rateLimitMessage: vi.fn(),
}));

vi.mock("../../api", () => ({
  getActorLists: (actor: string, limit: number, signal?: AbortSignal, cursor?: string) =>
    mocks.getActorLists(actor, limit, signal, cursor),
  isRateLimit: (error: unknown) => mocks.isRateLimit(error),
  rateLimitMessage: (error: unknown) => mocks.rateLimitMessage(error),
}));

import { ProfileListsTab, listPurposeLabel } from "./ProfileListsTab";

const curateList: ListView = {
  uri: "at://did:plc:actor/app.bsky.graph.list/curate",
  name: "Starter Pack",
  purpose: "app.bsky.graph.defs#curatelist",
  description: "A curated list",
  listItemCount: 12,
};

const modList: ListView = {
  uri: "at://did:plc:actor/app.bsky.graph.list/mod",
  name: "Blocklist",
  purpose: "app.bsky.graph.defs#modlist",
  creator: { did: "did:plc:actor", handle: "actor.test" },
};

describe("ProfileListsTab", () => {
  beforeEach(() => {
    mocks.getActorLists.mockReset();
    mocks.isRateLimit.mockReset();
    mocks.rateLimitMessage.mockReset();
  });

  it("renders a loading state while the actor's Lists load", () => {
    mocks.isRateLimit.mockReturnValue(false);
    mocks.rateLimitMessage.mockReturnValue("Something went wrong");
    mocks.getActorLists.mockReturnValue(new Promise(() => {}));
    render(<ProfileListsTab actor="did:plc:actor" onOpenFeed={vi.fn()} />);
    expect(screen.getByText("Loading Lists by this account")).toBeTruthy();
  });

  it("renders the actor's published Lists with purpose labels and member counts", async () => {
    mocks.isRateLimit.mockReturnValue(false);
    mocks.rateLimitMessage.mockReturnValue("Something went wrong");
    mocks.getActorLists.mockResolvedValue({ lists: [curateList], cursor: undefined });
    render(<ProfileListsTab actor="did:plc:actor" onOpenFeed={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Starter Pack")).toBeTruthy());
    const body = screen.getByText("Starter Pack").closest("span.discover-feed-body")!;
    expect(body.textContent).toContain("User list");
    expect(body.textContent).toContain("12 members");
  });

  it("opens a curated list timeline in-app from the Open list button", async () => {
    mocks.isRateLimit.mockReturnValue(false);
    mocks.rateLimitMessage.mockReturnValue("Something went wrong");
    mocks.getActorLists.mockResolvedValue({ lists: [curateList], cursor: undefined });
    const onOpenFeed = vi.fn();
    render(<ProfileListsTab actor="did:plc:actor" onOpenFeed={onOpenFeed} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open list" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Open list" }));
    expect(onOpenFeed).toHaveBeenCalledTimes(1);
    expect(onOpenFeed.mock.calls[0][0].id).toBe(curateList.uri);
  });

  it("keeps moderation lists on the Open-on-Bluesky link instead of an in-app feed", async () => {
    mocks.isRateLimit.mockReturnValue(false);
    mocks.rateLimitMessage.mockReturnValue("Something went wrong");
    mocks.getActorLists.mockResolvedValue({ lists: [modList], cursor: undefined });
    render(<ProfileListsTab actor="did:plc:actor" onOpenFeed={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Blocklist")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Open list" })).toBeNull();
    const external = screen.getByRole("link", { name: "Open on Bluesky" });
    expect(external.getAttribute("href")).toContain("bsky.app/profile/actor.test/lists/mod");
  });

  it("renders an empty state when the actor has published no Lists", async () => {
    mocks.isRateLimit.mockReturnValue(false);
    mocks.rateLimitMessage.mockReturnValue("Something went wrong");
    mocks.getActorLists.mockResolvedValue({ lists: [], cursor: undefined });
    render(<ProfileListsTab actor="did:plc:actor" onOpenFeed={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("No Lists")).toBeTruthy());
  });

  it("loads more Lists via the cursor when the user clicks Load more", async () => {
    mocks.isRateLimit.mockReturnValue(false);
    mocks.rateLimitMessage.mockReturnValue("Something went wrong");
    mocks.getActorLists.mockResolvedValueOnce({ lists: [curateList], cursor: "next" });
    mocks.getActorLists.mockResolvedValueOnce({ lists: [{ ...modList, name: "Second list" }], cursor: undefined });
    render(<ProfileListsTab actor="did:plc:actor" onOpenFeed={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Load more Lists" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Load more Lists" }));
    await waitFor(() => expect(screen.getByText("Second list")).toBeTruthy());
    expect(mocks.getActorLists).toHaveBeenLastCalledWith("did:plc:actor", 50, expect.anything(), "next");
  });
});

describe("listPurposeLabel", () => {
  it("labels moderation lists, curated lists, and the generic fallback", () => {
    expect(listPurposeLabel("app.bsky.graph.defs#modlist")).toBe("Moderation list");
    expect(listPurposeLabel("app.bsky.graph.defs#curatelist")).toBe("User list");
    expect(listPurposeLabel(undefined)).toBe("List");
    expect(listPurposeLabel("app.bsky.graph.defs#reference")).toBe("List");
  });
});
