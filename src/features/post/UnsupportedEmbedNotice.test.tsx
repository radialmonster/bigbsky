import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnsupportedEmbedNotice, formatUnsupportedEmbedType } from "./UnsupportedEmbedNotice";

const post = {
  uri: "at://did:plc:abc/app.bsky.feed.post/3k2xr",
  cid: "cid",
  author: { did: "did:plc:abc", handle: "alice.test" },
  record: {},
};

describe("UnsupportedEmbedNotice", () => {
  it("renders a notice naming the unsupported embed type with an Open on Bluesky link", () => {
    render(<UnsupportedEmbedNotice embedType="app.bsky.embed.starterPack#view" post={post} />);
    const note = screen.getByRole("note");
    expect(note.textContent).toContain("embedded starterPack content");
    const link = screen.getByRole("link", { name: "Open on Bluesky" }) as HTMLAnchorElement;
    expect(link.href).toBe("https://bsky.app/profile/alice.test/post/3k2xr");
  });

  it("uses a generic phrase for unfamiliar embed namespaces", () => {
    render(<UnsupportedEmbedNotice embedType="org.thirdparty.widget#view" post={post} />);
    expect(screen.getByRole("note").textContent).toContain("embedded content");
  });
});

describe("formatUnsupportedEmbedType", () => {
  it("strips the #view suffix and app.bsky.embed prefix", () => {
    expect(formatUnsupportedEmbedType("app.bsky.embed.images#view")).toBe("embedded images content");
  });

  it("keeps a generic phrase when the type is not in the app.bsky.embed namespace", () => {
    expect(formatUnsupportedEmbedType("app.bsky.feed.post#view")).toBe("embedded content");
  });
});
