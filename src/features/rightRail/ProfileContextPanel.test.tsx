import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Profile } from "../../api";
import { ProfileContextPanel } from "./ProfileContextPanel";

const profile: Profile = {
  did: "did:plc:test",
  handle: "alice.test",
  displayName: "Alice",
  avatar: "https://cdn.test/avatar.jpg",
  description: "Hello world",
  followersCount: 12,
  postsCount: 34,
};

describe("ProfileContextPanel", () => {
  it("renders the profile name, handle, description, and stats", () => {
    render(<ProfileContextPanel actor="alice.test" profile={profile} />);
    expect(screen.getByRole("heading", { name: "Alice" })).toBeTruthy();
    expect(screen.getByText("@alice.test")).toBeTruthy();
    expect(screen.getByText("Hello world")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("34")).toBeTruthy();
  });

  it("renders the avatar image when the profile has one", () => {
    const { container } = render(<ProfileContextPanel actor="alice.test" profile={profile} />);
    expect(container.querySelector("img.avatar")).toBeTruthy();
  });

  it("falls back to the actor handle and an avatar placeholder when the profile is null", () => {
    const { container } = render(<ProfileContextPanel actor="bob.test" profile={null} />);
    expect(screen.getByText("Unknown user")).toBeTruthy();
    expect(screen.getByText("@bob.test")).toBeTruthy();
    expect(container.querySelector("img.avatar")).toBeNull();
    expect(container.querySelector("span.avatar.fallback")).toBeTruthy();
  });
});
