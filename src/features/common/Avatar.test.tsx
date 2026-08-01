import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("renders the avatar image when the profile has one", () => {
    const { container } = render(<Avatar profile={{ did: "did:plc:abc", handle: "alice", avatar: "https://cdn.example/alice.jpg" }} />);
    const img = container.querySelector("img.avatar");
    expect(img?.getAttribute("src")).toBe("https://cdn.example/alice.jpg");
  });

  it("renders an empty fallback span for a profile without an avatar", () => {
    const { container } = render(<Avatar profile={{ did: "did:plc:abc", handle: "alice" }} />);
    const fallback = container.querySelector(".avatar.fallback");
    expect(fallback).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders the fallback when no profile is provided", () => {
    const { container } = render(<Avatar />);
    expect(container.querySelector(".avatar.fallback")).toBeTruthy();
  });
});
