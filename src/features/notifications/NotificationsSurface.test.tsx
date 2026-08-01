import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthState, NotificationItem } from "../../auth";

const mocks = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  markNotificationsSeen: vi.fn(),
  getMissingScopes: vi.fn(),
}));

vi.mock("../../auth", () => ({
  getNotifications: (cursor?: string) => mocks.getNotifications(cursor),
  markNotificationsSeen: () => mocks.markNotificationsSeen(),
  getMissingScopes: () => mocks.getMissingScopes(),
}));

import { NotificationsSurface } from "./NotificationsSurface";

const session = { did: "did:plc:abc", handle: "alice.test", displayName: "Alice" };
const signedOutAuth: AuthState = { status: "signed-out", session: null };
const signedInAuth: AuthState = { status: "signed-in", session };

function makeItem(partial: Partial<NotificationItem> & Pick<NotificationItem, "reason">): NotificationItem {
  return {
    cid: "cid",
    uri: "at://did:plc:bob/app.bsky.feed.post/1",
    author: { did: "did:plc:bob", handle: "bob.test", displayName: "Bob" },
    record: { text: "Hello there" },
    isRead: false,
    indexedAt: "2026-07-01T12:00:00Z",
    ...partial,
  };
}

function renderSurface(props: Partial<Parameters<typeof NotificationsSurface>[0]> = {}) {
  return render(
    <NotificationsSurface
      auth={signedInAuth}
      pinnedFeedCount={3}
      pinnedNotificationIds={[]}
      pinnedProfileCount={1}
      pinnedSearchCount={2}
      localListCount={0}
      onOpenSearch={vi.fn()}
      onTogglePinnedNotification={vi.fn()}
      onOpenPostByUri={vi.fn()}
      onOpenProfile={vi.fn()}
      onNotificationsSeen={vi.fn()}
      onReauthorize={vi.fn()}
      {...props}
    />,
  );
}

describe("NotificationsSurface", () => {
  beforeEach(() => {
    mocks.getNotifications.mockReset();
    mocks.markNotificationsSeen.mockReset();
    mocks.getMissingScopes.mockReset();
    mocks.markNotificationsSeen.mockResolvedValue(undefined);
    mocks.getMissingScopes.mockResolvedValue([]);
    mocks.getNotifications.mockResolvedValue({ notifications: [], cursor: undefined });
  });

  it("shows the signed-out reader summary and an open-search action instead of the live feed", () => {
    const onOpenSearch = vi.fn();
    const { container } = renderSurface({ auth: signedOutAuth, onOpenSearch });
    expect(screen.getByText(/Sign in to see your Bluesky notifications\./)).toBeTruthy();
    expect(screen.getByText("Open mention search")).toBeTruthy();
    expect(container.querySelector(".notif-feed")).toBeNull();
    fireEvent.click(screen.getByText("Open mention search"));
    expect(onOpenSearch).toHaveBeenCalled();
    expect(mocks.getNotifications).not.toHaveBeenCalled();
  });

  it("renders a loading state while notifications fetch", () => {
    mocks.getNotifications.mockReturnValue(new Promise(() => {}));
    renderSurface();
    expect(screen.getByText("Loading notifications")).toBeTruthy();
  });

  it("renders notification rows with reason text, handle, and preview", async () => {
    mocks.getNotifications.mockResolvedValue({
      notifications: [
        makeItem({ reason: "like", reasonSubject: "at://did:plc:abc/app.bsky.feed.post/root" }),
        makeItem({ reason: "follow" }),
      ],
      cursor: undefined,
    });
    renderSurface();
    await waitFor(() => expect(screen.getAllByText("Bob").length).toBe(2));
    expect(screen.getByText("liked your post")).toBeTruthy();
    expect(screen.getByText("followed you")).toBeTruthy();
    expect(screen.getAllByText("@bob.test").length).toBe(2);
    expect(screen.getAllByText("Hello there").length).toBe(2);
    expect(mocks.markNotificationsSeen).toHaveBeenCalled();
  });

  it("marks unseen rows with the unread class", async () => {
    mocks.getNotifications.mockResolvedValue({
      notifications: [makeItem({ reason: "reply" })],
      cursor: undefined,
    });
    const { container } = renderSurface();
    await waitFor(() => expect(screen.getByText("replied to you")).toBeTruthy());
    expect(container.querySelector(".notif-row.unread")).toBeTruthy();
  });

  it("opens the profile for follow notifications and the post for reply notifications", async () => {
    const onOpenProfile = vi.fn();
    const onOpenPostByUri = vi.fn();
    mocks.getNotifications.mockResolvedValue({
      notifications: [
        makeItem({ reason: "follow" }),
        makeItem({ reason: "reply", uri: "at://did:plc:bob/app.bsky.feed.post/hello" }),
      ],
      cursor: undefined,
    });
    renderSurface({ onOpenProfile, onOpenPostByUri });
    await waitFor(() => expect(screen.getAllByText("@bob.test").length).toBe(2));

    fireEvent.click(screen.getAllByText("followed you")[0]);
    expect(onOpenProfile).toHaveBeenCalled();

    fireEvent.click(screen.getAllByText("replied to you")[0]);
    expect(onOpenPostByUri).toHaveBeenCalledWith("at://did:plc:bob/app.bsky.feed.post/hello", "bob.test");
  });

  it("routes like/repost notifications to the subject post with the self handle", async () => {
    const onOpenPostByUri = vi.fn();
    mocks.getNotifications.mockResolvedValue({
      notifications: [makeItem({ reason: "like", reasonSubject: "at://did:plc:abc/app.bsky.feed.post/root" })],
      cursor: undefined,
    });
    renderSurface({ onOpenPostByUri });
    await waitFor(() => expect(screen.getByText("liked your post")).toBeTruthy());
    fireEvent.click(screen.getByText("liked your post"));
    expect(onOpenPostByUri).toHaveBeenCalledWith("at://did:plc:abc/app.bsky.feed.post/root", "alice.test");
  });

  it("filters to direct interactions on the Mentions tab", async () => {
    mocks.getNotifications.mockResolvedValue({
      notifications: [
        makeItem({ reason: "like", reasonSubject: "at://did:plc:abc/app.bsky.feed.post/root" }),
        makeItem({ reason: "mention" }),
        makeItem({ reason: "quote", uri: "at://did:plc:bob/app.bsky.feed.post/q" }),
        makeItem({ reason: "follow" }),
      ],
      cursor: undefined,
    });
    renderSurface();
    await waitFor(() => expect(screen.getAllByText("@bob.test").length).toBe(4));
    fireEvent.click(screen.getByText("Mentions"));
    expect(screen.getByText("mentioned you")).toBeTruthy();
    expect(screen.getByText("quoted your post")).toBeTruthy();
    expect(screen.queryByText("liked your post")).toBeNull();
    expect(screen.queryByText("followed you")).toBeNull();
  });

  it("shows an empty state when the ready list has no visible items", async () => {
    mocks.getNotifications.mockResolvedValue({ notifications: [], cursor: undefined });
    renderSurface();
    await waitFor(() => expect(screen.getByText("No notifications")).toBeTruthy());
    expect(screen.getByText("You're all caught up.")).toBeTruthy();
  });

  it("loads the next page via Load more and retains the cursor", async () => {
    mocks.getNotifications.mockResolvedValueOnce({
      notifications: [makeItem({ reason: "follow" })],
      cursor: "page2",
    });
    mocks.getNotifications.mockResolvedValueOnce({
      notifications: [makeItem({ reason: "mention", uri: "at://did:plc:bob/app.bsky.feed.post/m2" })],
      cursor: undefined,
    });
    renderSurface();
    await waitFor(() => expect(screen.getByText("followed you")).toBeTruthy());
    expect(screen.getByText("Load more")).toBeTruthy();
    fireEvent.click(screen.getByText("Load more"));
    await waitFor(() => expect(screen.getByText("mentioned you")).toBeTruthy());
    expect(mocks.getNotifications).toHaveBeenCalledWith("page2");
  });

  it("surfaces a load-more failure with a retry button that keeps loaded items", async () => {
    mocks.getNotifications.mockResolvedValueOnce({
      notifications: [makeItem({ reason: "follow" })],
      cursor: "page2",
    });
    mocks.getNotifications.mockRejectedValueOnce(new Error("rate limited"));
    renderSurface();
    await waitFor(() => expect(screen.getByText("followed you")).toBeTruthy());
    fireEvent.click(screen.getByText("Load more"));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(screen.getByText("followed you")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
    expect(screen.queryByText("Load more")).toBeNull();
  });

  it("offers a contextual reauthorize when the notification scope is missing", async () => {
    mocks.getNotifications.mockRejectedValue(new Error("unauthorized"));
    mocks.getMissingScopes.mockResolvedValue(["notification.listNotifications"]);
    const onReauthorize = vi.fn();
    renderSurface({ onReauthorize });
    await waitFor(() =>
      expect(screen.getByText(/Notifications need updated permissions/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByText("Update permissions"));
    expect(onReauthorize).toHaveBeenCalled();
  });

  it("shows a generic error with Retry when the failure is not a missing scope", async () => {
    mocks.getNotifications.mockRejectedValue(new Error("network"));
    renderSurface();
    await waitFor(() => expect(screen.getByText("Could not load notifications.")).toBeTruthy());
    expect(screen.queryByText("Update permissions")).toBeNull();
  });

  it("sorts pinned summary events first and toggles pin state", async () => {
    const onTogglePinnedNotification = vi.fn();
    const { container } = renderSurface({ pinnedNotificationIds: ["bookmarks"], onTogglePinnedNotification });
    const summary = container.querySelector(".notification-list");
    expect(summary).toBeTruthy();
    const labels = [...summary!.querySelectorAll("h3")].map((node) => node.textContent);
    expect(labels[0]).toBe("Bookmarks");
    const unpinButton = within(summary as HTMLElement).getByText("Unpin");
    fireEvent.click(unpinButton);
    expect(onTogglePinnedNotification).toHaveBeenCalledWith("bookmarks");
    fireEvent.click(within(summary as HTMLElement).getAllByText("Pin")[0]);
    expect(onTogglePinnedNotification).toHaveBeenCalledTimes(2);
  });
});
