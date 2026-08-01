import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListView } from "../../api";
import { ToastContext } from "../common/ToastHost";

const mocks = vi.hoisted(() => ({
  addAccountToList: vi.fn(),
  getListMembers: vi.fn(),
  getMissingScopes: vi.fn(),
  muteList: vi.fn(),
  removeListItem: vi.fn(),
  subscribeBlockList: vi.fn(),
  unmuteList: vi.fn(),
  unsubscribeBlockList: vi.fn(),
}));

vi.mock("../../auth", () => ({
  addAccountToList: (uri: string, handle: string) => mocks.addAccountToList(uri, handle),
  getListMembers: (uri: string) => mocks.getListMembers(uri),
  getMissingScopes: () => mocks.getMissingScopes(),
  muteList: (uri: string) => mocks.muteList(uri),
  removeListItem: (uri: string) => mocks.removeListItem(uri),
  subscribeBlockList: (uri: string) => mocks.subscribeBlockList(uri),
  unmuteList: (uri: string) => mocks.unmuteList(uri),
  unsubscribeBlockList: (uri: string) => mocks.unsubscribeBlockList(uri),
}));

import { BlueskyListCard, ListsSurface } from "./ListsSurface";

const curateList: ListView = {
  uri: "at://did:plc:owner/app.bsky.graph.list/curate",
  name: "Starter Pack",
  purpose: "app.bsky.graph.defs#curatelist",
  description: "A curated list",
  listItemCount: 12,
  creator: { did: "did:plc:owner", handle: "owner.test" },
};

const modList: ListView = {
  uri: "at://did:plc:other/app.bsky.graph.list/mod",
  name: "Blocklist",
  purpose: "app.bsky.graph.defs#modlist",
  description: "Blocks bad actors",
  creator: { did: "did:plc:other", handle: "other.test" },
};

function renderWithToast(ui: React.ReactElement) {
  const toasts: Array<{ message: string; kind?: string }> = [];
  const result = render(<ToastContext.Provider value={(message, kind) => toasts.push({ message, kind })}>{ui}</ToastContext.Provider>);
  return { ...result, toasts };
}

describe("BlueskyListCard", () => {
  beforeEach(() => {
    mocks.addAccountToList.mockReset();
    mocks.getListMembers.mockReset();
    mocks.getMissingScopes.mockReset();
    mocks.muteList.mockReset();
    mocks.removeListItem.mockReset();
    mocks.subscribeBlockList.mockReset();
    mocks.unmuteList.mockReset();
    mocks.unsubscribeBlockList.mockReset();
  });

  it("renders list name, purpose label, member count, and description", () => {
    renderWithToast(
      <BlueskyListCard list={curateList} owned={false} onOpenFeed={vi.fn()} />,
    );
    expect(screen.getByText("Starter Pack")).toBeTruthy();
    expect(screen.getByText("User list")).toBeTruthy();
    expect(screen.getByText("12 members")).toBeTruthy();
    expect(screen.getByText("A curated list")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open on Bluesky" })).toBeTruthy();
  });

  it("opens a curated list timeline in-app from the Open list button", () => {
    const onOpenFeed = vi.fn();
    renderWithToast(<BlueskyListCard list={curateList} owned={false} onOpenFeed={onOpenFeed} />);
    fireEvent.click(screen.getByRole("button", { name: "Open list" }));
    expect(onOpenFeed).toHaveBeenCalledTimes(1);
    expect(onOpenFeed.mock.calls[0][0].id).toBe(curateList.uri);
  });

  it("keeps moderation lists on the Open-on-Bluesky link instead of an in-app feed", () => {
    renderWithToast(<BlueskyListCard list={modList} owned={false} onOpenFeed={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Open list" })).toBeNull();
    const external = screen.getByRole("link", { name: "Open on Bluesky" });
    expect(external.getAttribute("href")).toContain("bsky.app/profile/other.test/lists/mod");
  });

  it("surfaces an error toast when deleting an owned list fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onDelete = vi.fn().mockRejectedValue(new Error("boom"));
    const { toasts } = renderWithToast(
      <BlueskyListCard list={curateList} owned signedInDid="did:plc:owner" onOpenFeed={vi.fn()} onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toasts).toEqual([{ message: "Couldn't delete this list. Please try again.", kind: "error" }]));
    expect(onDelete).toHaveBeenCalledWith(curateList.uri);
  });

  it("does not offer delete for a list owned by someone else", () => {
    renderWithToast(<BlueskyListCard list={modList} owned={false} signedInDid="did:plc:owner" onOpenFeed={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("re-syncs block-list subscription state when viewer.blocked changes", () => {
    const first: ListView = { ...modList, viewer: {} };
    const { rerender, toasts } = renderWithToast(
      <BlueskyListCard list={first} owned={false} onOpenFeed={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Subscribe (block)" })).toBeTruthy();
    const blocked: ListView = { ...modList, viewer: { blocked: "at://did:plc:owner/app.bsky.graph.listblock/1" } };
    rerender(
      <ToastContext.Provider value={(message, kind) => toasts.push({ message, kind })}>
        <BlueskyListCard list={blocked} owned={false} onOpenFeed={vi.fn()} />
      </ToastContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "Unsubscribe block" })).toBeTruthy();
  });

  it("subscribes to a moderation list as a block list after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.subscribeBlockList.mockResolvedValue("at://did:plc:owner/app.bsky.graph.listblock/1");
    renderWithToast(<BlueskyListCard list={modList} owned={false} onOpenFeed={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Subscribe (block)" }));
    await waitFor(() => expect(mocks.subscribeBlockList).toHaveBeenCalledWith(modList.uri));
    await waitFor(() => expect(screen.getByRole("button", { name: "Unsubscribe block" })).toBeTruthy());
  });
});

describe("ListMemberManager", () => {
  beforeEach(() => {
    mocks.getListMembers.mockReset();
    mocks.addAccountToList.mockReset();
    mocks.removeListItem.mockReset();
  });

  it("loads members on mount and lists them by display name and handle", async () => {
    mocks.getListMembers.mockResolvedValue({
      list: modList,
      members: [
        { listItemUri: "at://did:plc:owner/app.bsky.graph.listitem/1", subject: { did: "did:plc:one", handle: "one.test", displayName: "One" } },
        { listItemUri: "at://did:plc:owner/app.bsky.graph.listitem/2", subject: { did: "did:plc:two", handle: "two.test" } },
      ],
    });
    render(<BlueskyListCard list={modList} owned signedInDid="did:plc:owner" onOpenFeed={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Manage members" }));
    await waitFor(() => expect(screen.getByText("One")).toBeTruthy());
    expect(screen.getByText("@two.test")).toBeTruthy();
  });

  it("adds an account by handle and refreshes the member list", async () => {
    mocks.getListMembers
      .mockResolvedValueOnce({ list: modList, members: [] })
      .mockResolvedValueOnce({
        list: modList,
        members: [{ listItemUri: "at://did:plc:owner/app.bsky.graph.listitem/1", subject: { did: "did:plc:new", handle: "new.test" } }],
      });
    mocks.addAccountToList.mockResolvedValue("at://did:plc:owner/app.bsky.graph.listitem/1");
    render(<BlueskyListCard list={modList} owned signedInDid="did:plc:owner" onOpenFeed={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Manage members" }));
    await waitFor(() => expect(screen.getByText("No accounts on this list yet. Add one by handle above.")).toBeTruthy());
    const input = screen.getByRole("textbox", { name: "Add account by handle" });
    fireEvent.input(input, { target: { value: "new.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mocks.addAccountToList).toHaveBeenCalledWith(modList.uri, "new.test"));
    await waitFor(() => expect(screen.getByText("new.test")).toBeTruthy());
  });
});

describe("ListsSurface", () => {
  beforeEach(() => {
    mocks.getListMembers.mockReset();
    mocks.addAccountToList.mockReset();
    mocks.removeListItem.mockReset();
  });

  it("prompts signed-out visitors to sign in", () => {
    const containerRef = { current: null };
    render(
      <ListsSurface
        containerRef={containerRef as React.MutableRefObject<HTMLDivElement | null>}
        signedIn={false}
        myLists={{ owned: [], subscribed: [] }}
        myListsStatus="idle"
        onReloadMyLists={vi.fn()}
        onCreateModList={vi.fn()}
        onDeleteModList={vi.fn()}
        onOpenFeed={vi.fn()}
        onReauthorize={vi.fn()}
        lists={[]}
        onCreateList={vi.fn()}
        onDeleteList={vi.fn()}
      />,
    );
    expect(screen.getByText("Sign in to see your lists")).toBeTruthy();
  });

  it("shows loading while account lists load", () => {
    const containerRef = { current: null };
    render(
      <ListsSurface
        containerRef={containerRef as React.MutableRefObject<HTMLDivElement | null>}
        signedIn
        myLists={{ owned: [], subscribed: [] }}
        myListsStatus="loading"
        onReloadMyLists={vi.fn()}
        onCreateModList={vi.fn()}
        onDeleteModList={vi.fn()}
        onOpenFeed={vi.fn()}
        onReauthorize={vi.fn()}
        lists={[]}
        onCreateList={vi.fn()}
        onDeleteList={vi.fn()}
      />,
    );
    expect(screen.getByText("Loading your Bluesky lists")).toBeTruthy();
  });

  it("renders owned and subscribed list sections", () => {
    const containerRef = { current: null };
    render(
      <ListsSurface
        containerRef={containerRef as React.MutableRefObject<HTMLDivElement | null>}
        signedIn
        signedInDid="did:plc:owner"
        myLists={{ owned: [curateList], subscribed: [modList] }}
        myListsStatus="ready"
        onReloadMyLists={vi.fn()}
        onCreateModList={vi.fn()}
        onDeleteModList={vi.fn()}
        onOpenFeed={vi.fn()}
        onReauthorize={vi.fn()}
        lists={[]}
        onCreateList={vi.fn()}
        onDeleteList={vi.fn()}
      />,
    );
    expect(screen.getByText("Your lists")).toBeTruthy();
    expect(screen.getByText("Subscribed lists")).toBeTruthy();
    expect(screen.getByText("Starter Pack")).toBeTruthy();
    expect(screen.getByText("Blocklist")).toBeTruthy();
  });

  it("shows an error with a retry button when account lists fail to load", () => {
    const containerRef = { current: null };
    const onReloadMyLists = vi.fn();
    render(
      <ListsSurface
        containerRef={containerRef as React.MutableRefObject<HTMLDivElement | null>}
        signedIn
        myLists={{ owned: [], subscribed: [] }}
        myListsStatus="error"
        onReloadMyLists={onReloadMyLists}
        onCreateModList={vi.fn()}
        onDeleteModList={vi.fn()}
        onOpenFeed={vi.fn()}
        onReauthorize={vi.fn()}
        lists={[]}
        onCreateList={vi.fn()}
        onDeleteList={vi.fn()}
      />,
    );
    expect(screen.getByText("Could not load your lists.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onReloadMyLists).toHaveBeenCalledTimes(1);
  });

  it("toggles the browser collections section", () => {
    const containerRef = { current: null };
    render(
      <ListsSurface
        containerRef={containerRef as React.MutableRefObject<HTMLDivElement | null>}
        signedIn={false}
        myLists={{ owned: [], subscribed: [] }}
        myListsStatus="idle"
        onReloadMyLists={vi.fn()}
        onCreateModList={vi.fn()}
        onDeleteModList={vi.fn()}
        onOpenFeed={vi.fn()}
        onReauthorize={vi.fn()}
        lists={[{ id: "c1", name: "Links", description: "", createdAt: "" }]}
        onCreateList={vi.fn()}
        onDeleteList={vi.fn()}
      />,
    );
    expect(screen.queryByText("Links")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Browser collections/ }));
    expect(screen.getByText("Links")).toBeTruthy();
  });
});
