import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchBox } from "./SearchBox";

describe("SearchBox", () => {
  it("renders a search input and submits the current value", () => {
    const onSearch = vi.fn();
    const { container } = render(<SearchBox value="bluesky" onChange={vi.fn()} onSearch={onSearch} />);
    const input = screen.getByLabelText("Search") as HTMLInputElement;
    expect(input.value).toBe("bluesky");
    fireEvent.submit(container.querySelector("form")!);
    expect(onSearch).toHaveBeenCalledWith("bluesky");
  });

  it("reports typed edits via onChange without submitting", () => {
    const onChange = vi.fn();
    render(<SearchBox value="" onChange={onChange} onSearch={vi.fn()} />);
    fireEvent.input(screen.getByLabelText("Search"), { target: { value: "atproto" } });
    expect(onChange).toHaveBeenCalledWith("atproto");
  });

  it("shows a clear button only when the box has a value and clears on click", () => {
    const onChange = vi.fn();
    render(<SearchBox value="term" onChange={onChange} onSearch={vi.fn()} />);
    const clear = screen.getByRole("button", { name: "Clear search box" });
    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("hides the clear button when the box is empty", () => {
    render(<SearchBox value="" onChange={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Clear search box" })).toBeNull();
  });
});
