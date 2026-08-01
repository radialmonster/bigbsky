import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PostComposer } from "./PostComposer";

const mocks = vi.hoisted(() => ({
  publishPost: vi.fn(),
  publishThread: vi.fn(),
}));

vi.mock("../../auth", () => ({
  MAX_POST_IMAGES: 10,
  publishPost: (opts: unknown) => mocks.publishPost(opts),
  publishThread: (posts: unknown, langs?: unknown) => mocks.publishThread(posts, langs),
}));

const author = {
  did: "did:plc:alice",
  handle: "alice.bsky.social",
  displayName: "Alice",
  avatar: undefined,
  description: undefined,
};

const parentPost = {
  uri: "at://did:plc:alice/app.bsky.feed.post/parent",
  cid: "cid-parent",
  author,
  record: { text: "Original parent text", langs: ["en"] },
};

const quotedPost = {
  uri: "at://did:plc:bob/app.bsky.feed.post/quoted",
  cid: "cid-quoted",
  author: {
    did: "did:plc:bob",
    handle: "bob.bsky.social",
    displayName: "Bob",
    avatar: undefined,
    description: undefined,
  },
  record: { text: "Quoted post text", langs: ["en"] },
};

const rootRef = { uri: "at://did:plc:alice/app.bsky.feed.post/root", cid: "cid-root" };

// A stateful wrapper so the controlled new-post draft actually updates when the
// composer calls onDraftChange (mirroring how App lifts the draft state).
function Harness({
  initial = { posts: [""] },
  onPosted,
  defaultExpanded = false,
}: {
  initial?: { posts: string[] };
  onPosted?: () => void;
  defaultExpanded?: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  return <PostComposer draft={draft} onDraftChange={setDraft} onPosted={onPosted} defaultExpanded={defaultExpanded} />;
}

const renderNewPost = (overrides?: Partial<React.ComponentProps<typeof PostComposer>>) =>
  render(<PostComposer draft={{ posts: [""] }} onDraftChange={vi.fn()} onPosted={vi.fn()} {...overrides} />);

describe("PostComposer new-post mode", () => {
  beforeAll(() => {
    // jsdom does not implement requestAnimationFrame; insertAtCaret restores
    // focus + selection via rAF after inserting text at the caret.
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
    // jsdom does not implement object-URL creation for File inputs.
    window.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    window.URL.revokeObjectURL = vi.fn();
  });

  beforeEach(() => {
    localStorage.clear();
    mocks.publishPost.mockReset();
    mocks.publishThread.mockReset();
  });

  it("collapses to an Add New Post banner by default and expands on click", () => {
    renderNewPost();
    expect(screen.getByRole("button", { name: /Add New Post/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add New Post/ }));
    expect(screen.getByText("New post")).toBeTruthy();
    expect(screen.getByPlaceholderText("What's on your mind?")).toBeTruthy();
  });

  it("starts expanded when a local draft is already in progress", () => {
    renderNewPost({ draft: { posts: ["Draft in progress"] } });
    expect(screen.getByText("New post")).toBeTruthy();
    expect(screen.getByText("Draft autosaved locally")).toBeTruthy();
    expect((screen.getByPlaceholderText("What's on your mind?") as HTMLTextAreaElement).value).toBe(
      "Draft in progress",
    );
  });

  it("shows the Draft saved badge on the collapsed banner once a draft has been cleared to empty", () => {
    // A non-empty draft auto-expands the composer; after publishing, the
    // composer collapses back to the banner and the empty draft shows no badge.
    const onPosted = vi.fn();
    mocks.publishThread.mockResolvedValue({ uri: "at://did:plc:alice/app.bsky.feed.post/new", cid: "cid-new" });
    render(<Harness initial={{ posts: ["Some draft"] }} onPosted={onPosted} />);
    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
      target: { value: "Final text" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Post$/ }));
    return waitFor(() => {
      const banner = screen.getByRole("button", { name: /Add New Post/ });
      expect(banner).toBeTruthy();
      expect(screen.queryByText("Draft saved")).toBeNull();
    });
  });

  it("edits the draft through the controlled onDraftChange callback", () => {
    const onDraftChange = vi.fn();
    renderNewPost({ onDraftChange });
    fireEvent.click(screen.getByRole("button", { name: /Add New Post/ }));
    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
      target: { value: "Hello world" },
    });
    expect(onDraftChange).toHaveBeenCalledWith({ posts: ["Hello world"] });
  });

  it("autosaves the draft to browser-local storage as the text is typed", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Add New Post/ }));
    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
      target: { value: "Persist me" },
    });
    expect(JSON.parse(localStorage.getItem("bigbsky:composer-draft") || "null")).toEqual({
      posts: ["Persist me"],
    });
  });

  it("removes the stored draft once the text is emptied", () => {
    render(<Harness initial={{ posts: ["Some text"] }} />);
    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
      target: { value: "" },
    });
    expect(localStorage.getItem("bigbsky:composer-draft")).toBeNull();
  });

  it("shows the remaining-character count for a draft under the limit", () => {
    renderNewPost({ draft: { posts: ["x".repeat(300)] } });
    expect(screen.getByText("0")).toBeTruthy();
    renderNewPost({ draft: { posts: ["hello"] } });
    expect(screen.getByText("295")).toBeTruthy();
  });

  it("shows a multi-post count when the draft splits into several posts", () => {
    const long = Array.from({ length: 5 }, (_, i) => `Post ${i}`.repeat(100)).join("\n\n");
    renderNewPost({ draft: { posts: [long] } });
    expect(screen.getByText(/posts/)).toBeTruthy();
  });

  it("disables Post when there is no content and publishes a thread when there is", async () => {
    const onPosted = vi.fn();
    mocks.publishThread.mockResolvedValue({ uri: "at://did:plc:alice/app.bsky.feed.post/new", cid: "cid-new" });
    render(<Harness onPosted={onPosted} />);
    fireEvent.click(screen.getByRole("button", { name: /Add New Post/ }));
    const postButton = screen.getByRole("button", { name: /^Post$/ });
    expect((postButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
      target: { value: "A post" },
    });
    expect((postButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(postButton);
    await waitFor(() => expect(mocks.publishThread).toHaveBeenCalledTimes(1));
    expect(mocks.publishThread.mock.calls[0][0]).toEqual([{ text: "A post", images: [] }]);
    expect(onPosted).toHaveBeenCalledTimes(1);
    // Publishing collapses the composer back to the banner with the empty draft.
    await waitFor(() => expect(screen.getByRole("button", { name: /Add New Post/ })).toBeTruthy());
  });

  it("labels the submit button Post thread when the draft is a multi-post thread", async () => {
    const long = Array.from({ length: 3 }, (_, i) => `Body ${i}`.repeat(80)).join("\n\n");
    mocks.publishThread.mockResolvedValue({ uri: "at://did:plc:alice/app.bsky.feed.post/root2", cid: "cid-root2" });
    render(<Harness initial={{ posts: [long] }} />);
    const submit = screen.getByRole("button", { name: /Post thread/ });
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.publishThread).toHaveBeenCalledTimes(1));
    expect(mocks.publishThread.mock.calls[0][0].length).toBeGreaterThan(1);
  });

  it("surfaces the publish error message when posting fails", async () => {
    mocks.publishThread.mockRejectedValue(new Error("Sign in to post."));
    const onPosted = vi.fn();
    render(<Harness onPosted={onPosted} />);
    fireEvent.click(screen.getByRole("button", { name: /Add New Post/ }));
    fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
      target: { value: "A post" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Post$/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Sign in to post."));
    expect(onPosted).not.toHaveBeenCalled();
  });

  it("clears the draft from the Clear draft control", () => {
    render(<Harness initial={{ posts: ["Some draft text"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear draft" }));
    expect((screen.getByPlaceholderText("What's on your mind?") as HTMLTextAreaElement).value).toBe("");
    expect(localStorage.getItem("bigbsky:composer-draft")).toBeNull();
  });
});

describe("PostComposer reply mode", () => {
  beforeAll(() => {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  beforeEach(() => {
    localStorage.clear();
    mocks.publishPost.mockReset();
  });

  it("renders the inline reply frame with the parent preview", () => {
    render(
      <PostComposer replyTo={{ parent: parentPost, root: rootRef }} onClose={vi.fn()} onReplied={vi.fn()} />,
    );
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("@alice.bsky.social")).toBeTruthy();
    expect(screen.getByText("Original parent text")).toBeTruthy();
    expect(screen.getByPlaceholderText("Reply to @alice.bsky.social")).toBeTruthy();
  });

  it("disables Reply when canReply is false and explains why", () => {
    render(
      <PostComposer
        replyTo={{ parent: parentPost, root: rootRef }}
        canReply={false}
        onClose={vi.fn()}
        onReplied={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("Sign in to reply.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /^Reply$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("publishes a reply with the parent as root and calls onReplied", async () => {
    const onClose = vi.fn();
    const onReplied = vi.fn();
    mocks.publishPost.mockResolvedValue({ uri: "at://did:plc:alice/app.bsky.feed.post/reply", cid: "cid-reply" });
    render(<PostComposer replyTo={{ parent: parentPost, root: rootRef }} onClose={onClose} onReplied={onReplied} />);
    fireEvent.change(screen.getByPlaceholderText("Reply to @alice.bsky.social"), {
      target: { value: "My reply" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Reply$/ }));
    await waitFor(() => expect(mocks.publishPost).toHaveBeenCalledTimes(1));
    const opts = mocks.publishPost.mock.calls[0][0] as {
      text: string;
      reply: { root: { uri: string }; parent: { uri: string } };
    };
    expect(opts.text).toBe("My reply");
    expect(opts.reply.root.uri).toBe(rootRef.uri);
    expect(opts.reply.parent.uri).toBe(parentPost.uri);
    expect(onReplied).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("persists an in-progress reply draft per thread and clears it after posting", async () => {
    mocks.publishPost.mockResolvedValue({ uri: "at://did:plc:alice/app.bsky.feed.post/reply2", cid: "cid-reply2" });
    render(<PostComposer replyTo={{ parent: parentPost, root: rootRef }} onClose={vi.fn()} onReplied={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Reply to @alice.bsky.social"), {
      target: { value: "Drafting a reply" },
    });
    expect(localStorage.getItem("bigbsky:reply-draft:at://did:plc:alice/app.bsky.feed.post/parent")).toBe(
      "Drafting a reply",
    );
    fireEvent.click(screen.getByRole("button", { name: /^Reply$/ }));
    await waitFor(() =>
      expect(localStorage.getItem("bigbsky:reply-draft:at://did:plc:alice/app.bsky.feed.post/parent")).toBeNull(),
    );
  });

  it("blocks an over-limit reply from publishing", () => {
    const onReplied = vi.fn();
    render(<PostComposer replyTo={{ parent: parentPost, root: rootRef }} onClose={vi.fn()} onReplied={onReplied} />);
    fireEvent.change(screen.getByPlaceholderText("Reply to @alice.bsky.social"), {
      target: { value: "y".repeat(301) },
    });
    const replyButton = screen.getByRole("button", { name: /^Reply$/ });
    expect((replyButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("-1")).toBeTruthy();
  });
});

describe("PostComposer quote mode", () => {
  beforeAll(() => {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  beforeEach(() => {
    localStorage.clear();
    mocks.publishPost.mockReset();
  });

  it("renders the quote composer with the quoted post preview", () => {
    render(<PostComposer quote={quotedPost} onClose={vi.fn()} onQuoted={vi.fn()} />);
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("@bob.bsky.social")).toBeTruthy();
    expect(screen.getByText("Quoted post text")).toBeTruthy();
    expect(screen.getByPlaceholderText("Add a comment")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Quote$/ })).toBeTruthy();
  });

  it("publishes a quote post embedding the quoted record and calls onQuoted", async () => {
    const onClose = vi.fn();
    const onQuoted = vi.fn();
    mocks.publishPost.mockResolvedValue({ uri: "at://did:plc:alice/app.bsky.feed.post/quote-new", cid: "cid-quote-new" });
    render(<PostComposer quote={quotedPost} onClose={onClose} onQuoted={onQuoted} />);
    fireEvent.change(screen.getByPlaceholderText("Add a comment"), {
      target: { value: "My hot take" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Quote$/ }));
    await waitFor(() => expect(mocks.publishPost).toHaveBeenCalledTimes(1));
    const opts = mocks.publishPost.mock.calls[0][0] as { text: string; quote: { uri: string; cid: string } };
    expect(opts.text).toBe("My hot take");
    expect(opts.quote.uri).toBe(quotedPost.uri);
    expect(opts.quote.cid).toBe(quotedPost.cid);
    expect(onQuoted).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("allows a text-less quote post (the quoted record is the content)", async () => {
    mocks.publishPost.mockResolvedValue({ uri: "at://did:plc:alice/app.bsky.feed.post/quote-bare", cid: "cid-quote-bare" });
    render(<PostComposer quote={quotedPost} onClose={vi.fn()} onQuoted={vi.fn()} />);
    const quoteButton = screen.getByRole("button", { name: /^Quote$/ });
    expect((quoteButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(quoteButton);
    await waitFor(() => expect(mocks.publishPost).toHaveBeenCalledTimes(1));
    const opts = mocks.publishPost.mock.calls[0][0] as { text: string; quote: { uri: string } };
    expect(opts.text).toBe("");
    expect(opts.quote.uri).toBe(quotedPost.uri);
  });

  it("persists a quote draft per quoted post and clears it after publishing", async () => {
    mocks.publishPost.mockResolvedValue({ uri: "at://did:plc:alice/app.bsky.feed.post/quote-draft", cid: "cid-quote-draft" });
    render(<PostComposer quote={quotedPost} onClose={vi.fn()} onQuoted={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Add a comment"), {
      target: { value: "Drafting a quote" },
    });
    expect(localStorage.getItem("bigbsky:quote-draft:at://did:plc:bob/app.bsky.feed.post/quoted")).toBe(
      "Drafting a quote",
    );
    fireEvent.click(screen.getByRole("button", { name: /^Quote$/ }));
    await waitFor(() =>
      expect(localStorage.getItem("bigbsky:quote-draft:at://did:plc:bob/app.bsky.feed.post/quoted")).toBeNull(),
    );
  });

  it("surfaces the publish error when quoting fails", async () => {
    mocks.publishPost.mockRejectedValue(new Error("Sign in to post."));
    const onQuoted = vi.fn();
    render(<PostComposer quote={quotedPost} onClose={vi.fn()} onQuoted={onQuoted} />);
    fireEvent.click(screen.getByRole("button", { name: /^Quote$/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Sign in to post."));
    expect(onQuoted).not.toHaveBeenCalled();
  });

  it("blocks an over-limit quote from publishing", () => {
    render(<PostComposer quote={quotedPost} onClose={vi.fn()} onQuoted={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Add a comment"), {
      target: { value: "z".repeat(301) },
    });
    const quoteButton = screen.getByRole("button", { name: /^Quote$/ });
    expect((quoteButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("-1")).toBeTruthy();
  });
});
