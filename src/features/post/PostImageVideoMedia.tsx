import { useContext, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { getEmbedImages, getVideoEmbed, type FeedPost } from "../../api";
import { safeHttpUrl } from "../../lib/url";
import { sensitiveMediaValues } from "../../lib/moderation";
import { ShowMediaContext, useMediaReveal } from "../common/useMediaReveal";
import { MediaHiddenButton, SensitiveMediaGate } from "../common/MediaGate";
import { VideoEmbedCard } from "./VideoEmbedCard";
import type { ImageViewerState } from "./ImageViewer";

// Bluesky's newer gallery embed allows up to 10 authored images per post.
export const maxPostImages = 10;

export function safeEmbedImages(images: ReturnType<typeof getEmbedImages>) {
  return images
    .map((image) => ({
      ...image,
      thumb: safeHttpUrl(image.thumb),
      fullsize: safeHttpUrl(image.fullsize),
    }))
    .filter((image) => image.thumb || image.fullsize);
}

export function PostImageVideoMedia({ post, onOpenImage }: { post: FeedPost; onOpenImage?: (image: ImageViewerState) => void }) {
  const showMedia = useContext(ShowMediaContext);
  const images = safeEmbedImages(getEmbedImages(post.embed));
  const video = getVideoEmbed(post.embed);
  const mediaWarningValues = sensitiveMediaValues([...(post.labels ?? []), ...(post.author.labels ?? [])]);
  const { revealed: mediaRevealed, setRevealed, gate: gateMedia, hidden: hideMediaForSetting } = useMediaReveal({
    sensitiveWarningCount: mediaWarningValues.length,
    hasMedia: images.length > 0 || !!video,
    hasThumbnail: false,
  });

  if (images.length === 0 && !video) {
    return null;
  }

  if (gateMedia) {
    return <SensitiveMediaGate values={mediaWarningValues} onReveal={() => setRevealed(true)} />;
  }

  if (hideMediaForSetting) {
    return <MediaHiddenButton kind={images.length > 0 ? "image" : "video"} onReveal={() => setRevealed(true)} />;
  }

  const hideMediaButton =
    mediaRevealed && (mediaWarningValues.length > 0 || !showMedia) ? (
      <MediaHiddenButton kind={images.length > 0 ? "image" : "video"} revealed onReveal={() => setRevealed(false)} />
    ) : null;

  return (
    <>
      {hideMediaButton}
      <div className="post-image-video-media">
        {images.length === 1 && (
          <div className="image-grid count-1">
            {images.slice(0, 1).map((image) => (
              <button
                className="image-button"
                key={image.thumb || image.fullsize}
                type="button"
                onClick={(event) => {
                  if (!clickedImageElement(event)) {
                    return;
                  }
                  const viewerImages = feedViewerImages(images);
                  if (viewerImages.length === 0) {
                    return;
                  }
                  onOpenImage?.({ images: viewerImages, index: 0 });
                }}
                aria-label={image.alt ? "Open image" : "Open full size image"}
              >
                <img
                  alt={image.alt || ""}
                  src={image.thumb || image.fullsize}
                  loading="lazy"
                  decoding="async"
                  style={
                    image.aspectRatio?.width && image.aspectRatio?.height
                      ? { aspectRatio: `${image.aspectRatio.width} / ${image.aspectRatio.height}` }
                      : undefined
                  }
                />
              </button>
            ))}
          </div>
        )}
        {images.length > 1 && (
          <MasonryImageGrid
            images={images}
            rowKeyPrefix={`image-row-${post.uri}`}
            containerClass="image-grid"
            renderImage={(image, row, flatIndex) => {
              const viewerImages = feedViewerImages(images);
              const selectedIndex = Math.max(0, viewerImages.findIndex((viewerImage) => viewerImage.src === (image.fullsize || image.thumb)));
              return (
                <button
                  className="image-button"
                  key={image.thumb || image.fullsize}
                  type="button"
                  style={{ "--media-aspect": imageAspectRatio(image) } as CSSProperties}
                  onClick={(event) => {
                    if (!clickedImageElement(event)) {
                      return;
                    }
                    if (viewerImages.length === 0) {
                      return;
                    }
                    onOpenImage?.({ images: viewerImages, index: selectedIndex });
                  }}
                  aria-label={image.alt ? "Open image" : "Open full size image"}
                >
                  <img
                    alt={image.alt || ""}
                    src={image.thumb || image.fullsize}
                    loading="lazy"
                    decoding="async"
                    style={
                      row.length === 1 && image.aspectRatio?.width && image.aspectRatio?.height
                        ? { aspectRatio: `${image.aspectRatio.width} / ${image.aspectRatio.height}` }
                        : undefined
                    }
                  />
                  {images.length > maxPostImages && flatIndex === maxPostImages - 1 && (
                    <span className="more-media-badge">+{images.length - maxPostImages}</span>
                  )}
                </button>
              );
            }}
          />
        )}
        {video && <VideoEmbedCard video={video} />}
      </div>
    </>
  );
}

export function feedViewerImages(images: ReturnType<typeof getEmbedImages>) {
  return images
    .slice(0, maxPostImages)
    .map((viewerImage) => ({
      src: viewerImage.fullsize || viewerImage.thumb || "",
      previewSrc: viewerImage.thumb && viewerImage.fullsize && viewerImage.thumb !== viewerImage.fullsize ? viewerImage.thumb : undefined,
      alt: viewerImage.alt || "",
    }))
    .filter((viewerImage) => viewerImage.src);
}

export function clickedImageElement(event: ReactMouseEvent<HTMLButtonElement>) {
  // The "+N more" overflow badge lives inside the last image button; clicking
  // it should open the viewer too (its target is the span, not the img).
  return (
    event.target instanceof HTMLImageElement ||
    (event.target instanceof HTMLElement && event.target.classList.contains("more-media-badge"))
  );
}

export function imageAspectRatio(image: ReturnType<typeof getEmbedImages>[number]) {
  const width = image.aspectRatio?.width;
  const height = image.aspectRatio?.height;
  return width && height ? Math.max(0.45, Math.min(2.4, width / height)) : 1;
}

function pairedImageRows(images: ReturnType<typeof getEmbedImages>) {
  const rows: Array<ReturnType<typeof getEmbedImages>> = [];
  for (let index = 0; index < images.length; index += 2) {
    rows.push(images.slice(index, index + 2));
  }
  return rows;
}

// Shared masonry image grid: wraps paired rows with the row-aspect style the
// CSS masonry layout keys off of. The cell content differs between card
// variants (interactive viewer buttons vs. static imgs), so it is supplied via
// the renderImage callback.
export function MasonryImageGrid({
  images,
  rowKeyPrefix,
  containerClass,
  renderImage,
}: {
  images: ReturnType<typeof getEmbedImages>;
  rowKeyPrefix: string;
  containerClass: string;
  renderImage: (image: ReturnType<typeof getEmbedImages>[number], row: ReturnType<typeof getEmbedImages>, flatIndex: number) => ReactNode;
}) {
  return (
    <div className={`${containerClass} image-masonry count-${Math.min(images.length, 4)}`}>
      {pairedImageRows(images.slice(0, maxPostImages)).map((row, rowIndex) => (
        <div
          className={row.length === 1 ? "image-row image-row-solo" : "image-row"}
          key={`${rowKeyPrefix}-${rowIndex}`}
          style={{ "--media-row-aspect": row.reduce((total, image) => total + imageAspectRatio(image), 0) } as CSSProperties}
        >
          {row.map((image, imageIndex) => renderImage(image, row, rowIndex * 2 + imageIndex))}
        </div>
      ))}
    </div>
  );
}
