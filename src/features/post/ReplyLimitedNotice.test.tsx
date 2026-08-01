import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReplyLimitedNotice } from "./ReplyLimitedNotice";

describe("ReplyLimitedNotice", () => {
  it("renders the limited-replies status notice", () => {
    render(<ReplyLimitedNotice />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Replies are limited");
  });
});
