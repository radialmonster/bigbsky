import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExternalLinkCard, formatExternalUrlLabel } from "./ExternalLinkCard";

const external = {
  uri: "https://www.example.com/articles/one",
  title: "Example article",
  description: "A short description",
  thumb: "https://cdn.example.com/thumb.jpg",
};

describe("ExternalLinkCard", () => {
  it("renders the title, host label, description, and thumbnail", () => {
    const { container } = render(<ExternalLinkCard external={external} />);
    expect(container.querySelector(".link-card")).toBeTruthy();
    expect(container.querySelector(".link-card strong")?.textContent).toBe("Example article");
    expect(container.querySelector(".link-card em")?.textContent).toBe("Open example.com/articles/one");
    expect(container.querySelector(".link-card small")?.textContent).toBe("A short description");
    expect(container.querySelector(".link-card img")?.getAttribute("src")).toBe("https://cdn.example.com/thumb.jpg");
    const link = container.querySelector(".link-card a") as HTMLAnchorElement;
    expect(link.href).toBe("https://www.example.com/articles/one");
  });

  it("hides the thumbnail and marks the card no-media when hideThumbnail is set", () => {
    const { container } = render(<ExternalLinkCard external={external} hideThumbnail />);
    expect(container.querySelector(".link-card.no-media")).toBeTruthy();
    expect(container.querySelector(".link-card img")).toBeNull();
    expect(container.querySelector(".link-card strong")?.textContent).toBe("Example article");
  });

  it("collapses to a text-only card when the embed has no thumbnail", () => {
    const { container } = render(<ExternalLinkCard external={{ ...external, thumb: undefined }} />);
    expect(container.querySelector(".link-card.no-media")).toBeTruthy();
    expect(container.querySelector(".link-card img")).toBeNull();
  });

  it("renders nothing when the uri is not a safe http(s) URL", () => {
    const { container } = render(<ExternalLinkCard external={{ uri: "javascript:alert(1)" }} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("formatExternalUrlLabel", () => {
  it("strips the www prefix and trailing slash", () => {
    expect(formatExternalUrlLabel("https://www.example.com/path/")).toBe("example.com/path");
  });

  it("falls back to the raw uri when unparseable", () => {
    expect(formatExternalUrlLabel("not a url")).toBe("not a url");
  });
});
