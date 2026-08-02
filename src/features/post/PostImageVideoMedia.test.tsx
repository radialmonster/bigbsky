import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FeedPost } from "../../api";
import { ShowMediaContext, ShowNsfwContext } from "../common/useMediaReveal";
import { PostImageVideoMedia, maxPostImages } from "./PostImageVideoMedia";

const author = (labels: Array<{ val?: string }> = []) => ({
  did: "did:plc:author",
  handle: "author.bsky.social",
  displayName: "Author",
  labels,
});

const makePost = (overrides: Partial<FeedPost>): FeedPost => ({
  uri: "at://did:plc:author/app.bsky.feed.post/abc",
  cid: "cid-1",
  author: author(),
  record: { text: "hello" },
  ...overrides,
});

const imageEmbed = (images: Array<{ thumb?: string; fullsize?: string; alt?: string; aspectRatio?: { width?: number; height?: number } }>) => ({
  type: "app.bsky.embed.images",
  images,
});

const videoEmbed = {
  type: "app.bsky.embed.video",
  playlist: "https://cdn.example.com/v.m3u8",
  thumbnail: "https://cdn.example.com/t.jpg",
  aspectRatio: { width: 16, height: 9 },
  alt: "A video",
};

const renderMedia = (post: FeedPost, { showMedia = true, showNsfw = true } = {}) =>
  render(
    <ShowNsfwContext.Provider value={showNsfw}>
      <ShowMediaContext.Provider value={showMedia}>
        <PostImageVideoMedia post={post} onOpenImage={() => {}} />
      </ShowMediaContext.Provider>
    </ShowNsfwContext.Provider>,
  );

describe("PostImageVideoMedia", () => {
  it("renders nothing when the post has no image or video embed", () => {
    const { container } = renderMedia(makePost({ embed: undefined }));
    expect(container.innerHTML).toBe("");
  });

  it("applies Bluesky aspect-ratio metadata to a single image as an inline aspect-ratio style", () => {
    const { container } = renderMedia(
      makePost({ embed: imageEmbed([{ thumb: "https://cdn.example.com/a.jpg", aspectRatio: { width: 4, height: 3 } }]) }),
    );
    const img = container.querySelector(".image-grid.count-1 img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.style.aspectRatio).toBe("4 / 3");
  });

  it("leaves a single image unconstrained when the embed has no aspect-ratio metadata", () => {
    const { container } = renderMedia(
      makePost({ embed: imageEmbed([{ thumb: "https://cdn.example.com/a.jpg" }]) }),
    );
    const img = container.querySelector(".image-grid.count-1 img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.style.aspectRatio).toBe("");
  });

  it("renders a masonry grid with one button per image for multi-image posts", () => {
    const { container } = renderMedia(
      makePost({
        embed: imageEmbed([
          { thumb: "https://cdn.example.com/a.jpg" },
          { thumb: "https://cdn.example.com/b.jpg" },
        ]),
      }),
    );
    expect(container.querySelector(".image-masonry")).toBeTruthy();
    expect(container.querySelectorAll("button.image-button")).toHaveLength(2);
  });

  it("shows the +N more badge when the gallery exceeds maxPostImages", () => {
    const images = Array.from({ length: maxPostImages + 3 }, (_, index) => ({
      thumb: `https://cdn.example.com/${index}.jpg`,
    }));
    const { container } = renderMedia(makePost({ embed: imageEmbed(images) }));
    const badge = container.querySelector(".more-media-badge");
    expect(badge?.textContent).toBe(`+${images.length - maxPostImages}`);
  });

  it("renders a video embed card when the post embeds video", () => {
    const { container } = renderMedia(makePost({ embed: videoEmbed }));
    expect(container.querySelector(".video-card")).toBeTruthy();
  });

  it("opens the image viewer on a single-image click", () => {
    const onOpenImage = vi.fn();
    const { container } = render(
      <ShowNsfwContext.Provider value={true}>
        <ShowMediaContext.Provider value={true}>
          <PostImageVideoMedia
            post={makePost({ embed: imageEmbed([{ thumb: "https://cdn.example.com/a.jpg", fullsize: "https://cdn.example.com/a-full.jpg", alt: "Alt" }]) })}
            onOpenImage={onOpenImage}
          />
        </ShowMediaContext.Provider>
      </ShowNsfwContext.Provider>,
    );
    fireEvent.click(container.querySelector(".image-grid.count-1 img") as HTMLImageElement);
    expect(onOpenImage).toHaveBeenCalledWith({ images: [{ src: "https://cdn.example.com/a-full.jpg", previewSrc: "https://cdn.example.com/a.jpg", alt: "Alt" }], index: 0 });
  });

  it("gates sensitive media behind the reveal warning when the NSFW preference is off", () => {
    const { container } = renderMedia(
      makePost({
        embed: imageEmbed([{ thumb: "https://cdn.example.com/a.jpg" }]),
        labels: [{ val: "porn" }],
      }),
      { showNsfw: false },
    );
    expect(container.querySelector(".sensitive-media-gate")).toBeTruthy();
    expect(container.querySelector(".image-grid")).toBeNull();
  });

  it("shows a reveal-media button when the Show Media setting is off", () => {
    const { container } = renderMedia(
      makePost({ embed: imageEmbed([{ thumb: "https://cdn.example.com/a.jpg" }]) }),
      { showMedia: false },
    );
    expect(container.querySelector(".media-hidden-button")).toBeTruthy();
    expect(container.querySelector(".image-grid")).toBeNull();
  });
});
