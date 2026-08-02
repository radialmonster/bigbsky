import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FeedItem, FeedPost, Profile, RecordEmbedView, RichTextFacet } from "../../api";
import { ShowMediaContext, ShowNsfwContext } from "../common/useMediaReveal";
import { DensityContext, TagSearchContext } from "./PostCardContexts";
import { PostCard, PostEmbeds, QuotedPostCard } from "./PostCard";

const author = (labels: Array<{ val?: string }> = []): Profile => ({
  did: "did:plc:author",
  handle: "author.bsky.social",
  displayName: "Author",
  labels,
});

const makePost = (overrides: Partial<FeedPost> = {}): FeedPost => ({
  uri: "at://did:plc:author/app.bsky.feed.post/abc",
  cid: "cid-1",
  author: author(),
  record: { text: "hello", createdAt: "2026-01-01T00:00:00.000Z" },
  replyCount: 0,
  repostCount: 0,
  likeCount: 0,
  quoteCount: 0,
  ...overrides,
});

const makeItem = (post: FeedPost): FeedItem => ({ post });

const linkFacet = (byteStart: number, byteEnd: number, uri: string): RichTextFacet => ({
  index: { byteStart, byteEnd },
  features: [{ $type: "app.bsky.richtext.facet#link", uri }],
});

const imageEmbed = (images: Array<{ thumb?: string; fullsize?: string; alt?: string; aspectRatio?: { width?: number; height?: number } }>) => ({
  type: "app.bsky.embed.images",
  images,
});

const renderCard = (item: FeedItem, { density = "comfortable" as string, showMedia = true } = {}) =>
  render(
    <ShowNsfwContext.Provider value={false}>
      <ShowMediaContext.Provider value={showMedia}>
        <DensityContext.Provider value={density}>
          <PostCard item={item} />
        </DensityContext.Provider>
      </ShowMediaContext.Provider>
    </ShowNsfwContext.Provider>,
  );

describe("PostCard", () => {
  it("renders a text-only post card with the author header", () => {
    const { container } = renderCard(makeItem(makePost()));
    const card = container.querySelector("article.post-card") as HTMLElement;
    expect(card).toBeTruthy();
    expect(container.querySelector(".post-header")).toBeTruthy();
    expect(container.querySelector(".post-text")?.textContent).toContain("hello");
  });

  it("renders rich-text facets for post body text", () => {
    const text = "see https://example.com now";
    const { container } = renderCard(
      makeItem(makePost({ record: { text, createdAt: "2026-01-01T00:00:00.000Z", facets: [linkFacet(4, 23, "https://example.com")] } })),
    );
    const link = container.querySelector(".post-text a.post-link") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.href).toBe("https://example.com/");
  });

  it("shows a moderation notice when the author carries an account-level sensitive label", () => {
    const post = makePost({ author: author([{ val: "porn" }]) });
    const { container } = renderCard(makeItem(post));
    const notice = container.querySelector(".moderation-notice") as HTMLElement;
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain("Porn");
  });

  it("does not add a moderation notice for a plain post", () => {
    const { container } = renderCard(makeItem(makePost()));
    expect(container.querySelector(".moderation-notice")).toBeNull();
  });

  it("substitutes the media-only card in media density for an image post", () => {
    const post = makePost({ embed: imageEmbed([{ thumb: "https://cdn.example.com/a.jpg" }]) });
    const { container } = renderCard(makeItem(post), { density: "media" });
    expect(container.querySelector("article.media-only-card")).toBeTruthy();
  });

  it("renders a full card for an image post in comfortable density", () => {
    const post = makePost({ embed: imageEmbed([{ thumb: "https://cdn.example.com/a.jpg" }]) });
    const { container } = renderCard(makeItem(post));
    expect(container.querySelector("article.post-card.has-media")).toBeTruthy();
  });
});

describe("PostEmbeds", () => {
  it("renders an external link card when the post embeds a link", () => {
    const post = makePost({
      embed: { type: "app.bsky.embed.external", external: { uri: "https://example.com", title: "Example", description: "desc" } },
    });
    const { container } = render(
      <ShowNsfwContext.Provider value={false}>
        <ShowMediaContext.Provider value={true}>
          <PostEmbeds post={post} />
        </ShowMediaContext.Provider>
      </ShowNsfwContext.Provider>,
    );
    const link = container.querySelector(".link-card a") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.href).toBe("https://example.com/");
  });
});

describe("QuotedPostCard", () => {
  const quoteRecord = (overrides: Partial<RecordEmbedView> = {}): RecordEmbedView => ({
    uri: "at://did:plc:author/app.bsky.feed.post/quote",
    cid: "cid-quote",
    author: author(),
    value: { text: "quoted hello", createdAt: "2026-01-01T00:00:00.000Z" },
    ...overrides,
  });

  const renderQuote = (record: RecordEmbedView, onOpenTag?: (tag: string) => void) =>
    render(
      <TagSearchContext.Provider value={onOpenTag ?? null}>
        <ShowNsfwContext.Provider value={false}>
          <ShowMediaContext.Provider value={true}>
            <QuotedPostCard record={record} />
          </ShowMediaContext.Provider>
        </ShowNsfwContext.Provider>
      </TagSearchContext.Provider>,
    );

  it("renders the quoted post text", () => {
    const { container } = renderQuote(quoteRecord());
    expect(container.querySelector(".quote-text")?.textContent).toContain("quoted hello");
  });

  it("renders rich-text facets for the quoted post body text", () => {
    const text = "read https://example.com";
    const { container } = renderQuote(
      quoteRecord({ value: { text, createdAt: "2026-01-01T00:00:00.000Z", facets: [linkFacet(5, 24, "https://example.com")] } }),
    );
    const link = container.querySelector(".quote-text a.post-link") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.href).toBe("https://example.com/");
  });

  it("gates quoted media behind the sensitive warning when labels are present and NSFW is hidden", () => {
    const record = quoteRecord({
      value: { text: "quoted hello", createdAt: "2026-01-01T00:00:00.000Z", embed: imageEmbed([{ thumb: "https://cdn.example.com/q.jpg" }]) },
      labels: [{ val: "porn" }],
    });
    const { container } = renderQuote(record);
    expect(container.querySelector(".sensitive-media-gate")).toBeTruthy();
  });

  it("opens an in-app tag search when a quoted tag facet is clicked", () => {
    const onOpenTag = vi.fn();
    const text = "#BlueSky quote";
    const tagFacet: RichTextFacet = {
      index: { byteStart: 0, byteEnd: 8 },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: "BlueSky" }],
    };
    const { container } = renderQuote(
      quoteRecord({ value: { text, createdAt: "2026-01-01T00:00:00.000Z", facets: [tagFacet] } }),
      onOpenTag,
    );
    const tag = container.querySelector(".quote-text button.post-tag") as HTMLButtonElement;
    expect(tag).toBeTruthy();
    fireEvent.click(tag);
    expect(onOpenTag).toHaveBeenCalledWith("BlueSky");
  });
});
