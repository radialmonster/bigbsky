import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorState, LoadingState } from "./State";

describe("LoadingState", () => {
  it("renders the loading label", () => {
    render(<LoadingState label="Loading posts" />);
    expect(screen.getByText("Loading posts")).toBeTruthy();
  });
});

describe("ErrorState", () => {
  it("renders the fixed failure heading and the message", () => {
    render(<ErrorState message="Rate limited" />);
    expect(screen.getByText("Unable to load")).toBeTruthy();
    expect(screen.getByText("Rate limited")).toBeTruthy();
  });
});
