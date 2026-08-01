import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ImageViewer } from "./ImageViewer";

const images = [
  { src: "https://cdn.bsky.app/img/1.jpg", previewSrc: "https://cdn.bsky.app/img/1_sm.jpg", alt: "First alt" },
  { src: "https://cdn.bsky.app/img/2.jpg", previewSrc: "https://cdn.bsky.app/img/2_sm.jpg", alt: "Second alt" },
];

const renderViewer = (index = 0, overrides?: Partial<React.ComponentProps<typeof ImageViewer>>) =>
  render(
    <ImageViewer
      image={{ images, index }}
      onChange={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );

describe("ImageViewer", () => {
  beforeAll(() => {
    // jsdom does not implement matchMedia; ImageViewer uses it to decide whether
    // the info footer starts visible (desktop = visible).
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() });
  });
  it("renders the selected image with its alt text", () => {
    renderViewer();
    const image = screen.getByRole("dialog", { name: "Image viewer" });
    expect(image).toBeTruthy();
    // The main image is present with the preview source until the original loads.
    const img = document.querySelector('img[src*="1_sm.jpg"]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(screen.getByText("First alt")).toBeTruthy();
  });

  it("shows image X of Y for multi-image posts", () => {
    renderViewer(0);
    expect(screen.getByText("1 / 2")).toBeTruthy();
    expect(screen.getByText("Image 1 of 2")).toBeTruthy();
  });

  it("does not render thumbnails for single-image posts", () => {
    renderViewer(0, { image: { images: [images[0]], index: 0 } });
    expect(screen.queryByRole("button", { name: "Open image 2" })).toBeNull();
  });

  it("renders thumbnail buttons for multi-image posts and navigates on click", () => {
    const onChange = vi.fn();
    renderViewer(0, { onChange });
    const thumb = screen.getByRole("button", { name: "Open image 2" });
    fireEvent.click(thumb);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ index: 1 }));
  });

  it("navigates with arrow keys", () => {
    const onChange = vi.fn();
    renderViewer(0, { onChange });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ index: 1 }));
  });

  it("wraps navigation around the image list", () => {
    const onChange = vi.fn();
    renderViewer(0, { onChange });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ index: 1 }));
  });

  it("closes on Escape and via the close button", () => {
    const onClose = vi.fn();
    renderViewer(0, { onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close image viewer" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("toggles the info footer with the info button", () => {
    renderViewer();
    // Desktop: the info footer is visible by default.
    expect(screen.getByText("Open original")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide image information" }));
    expect(screen.queryByText("Open original")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show image information" }));
    expect(screen.getByText("Open original")).toBeTruthy();
  });

  it("links to the original source image", () => {
    renderViewer();
    const link = screen.getByRole("link", { name: "Open original" }) as HTMLAnchorElement;
    expect(link.href).toContain("/img/1.jpg");
    expect(link.target).toBe("_blank");
  });

  it("renders a 'No alt text provided.' fallback when alt is missing", () => {
    renderViewer(0, {
      image: { images: [{ src: "https://cdn.bsky.app/img/1.jpg", alt: "" }], index: 0 },
    });
    expect(screen.getByText("No alt text provided.")).toBeTruthy();
  });
});
