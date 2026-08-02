import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VideoEmbedCard } from "./VideoEmbedCard";

const baseVideo = {
  type: "app.bsky.embed.video",
  playlist: undefined,
  thumbnail: undefined,
  aspectRatio: undefined,
  alt: "",
};

describe("VideoEmbedCard", () => {
  it("puts Bluesky aspect-ratio metadata on the stable card frame", () => {
    const { container } = render(
      <VideoEmbedCard video={{ ...baseVideo, aspectRatio: { width: 16, height: 9 } }} />,
    );
    const card = container.querySelector(".video-card") as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.style.getPropertyValue("--video-aspect")).toBe("16 / 9");
  });

  it("leaves the card frame unconstrained when no aspect ratio is known", () => {
    const { container } = render(<VideoEmbedCard video={{ ...baseVideo, aspectRatio: { width: 0, height: 0 } }} />);
    const card = container.querySelector(".video-card") as HTMLElement;
    expect(card.style.getPropertyValue("--video-aspect")).toBe("");
  });

  it("adds the quote-video-card class in compact context", () => {
    const { container } = render(<VideoEmbedCard video={{ ...baseVideo, thumbnail: "https://cdn.example.com/t.jpg" }} compact />);
    expect(container.querySelector(".video-card.quote-video-card")).toBeTruthy();
  });

  it("labels GIF embeds as GIF and others as Video", () => {
    const { container } = render(<VideoEmbedCard video={{ ...baseVideo, type: "app.bsky.embed.video#gif" }} />);
    expect(container.querySelector(".video-label")?.textContent).toContain("GIF");
    const { container: plain } = render(<VideoEmbedCard video={{ ...baseVideo }} />);
    expect(plain.querySelector(".video-label")?.textContent).toContain("Video");
  });

  it("falls back to a thumbnail link when there is no playlist", () => {
    const { container } = render(
      <VideoEmbedCard video={{ ...baseVideo, thumbnail: "https://cdn.example.com/t.jpg", alt: "A cat" }} />,
    );
    const link = container.querySelector("a.video-fallback-link") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.href).toBe("https://cdn.example.com/t.jpg");
    expect(container.querySelector(".video-fallback-link img")?.getAttribute("src")).toBe("https://cdn.example.com/t.jpg");
  });

  it("renders a placeholder when neither playlist nor thumbnail is available", () => {
    const { container } = render(<VideoEmbedCard video={baseVideo} />);
    expect(container.querySelector(".video-placeholder")).toBeTruthy();
    expect(container.querySelector(".video-open-link")).toBeNull();
  });
});
