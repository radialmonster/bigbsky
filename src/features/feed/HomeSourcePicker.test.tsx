import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { HomeSourcePicker, type HomeOption } from "./HomeSourcePicker";

beforeAll(() => {
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => {};
  }
});

const options: HomeOption[] = [
  { id: "following", label: "Following", needsAuth: true, group: "Following" },
  { id: "discover", label: "Discover", needsAuth: false, group: "Feeds" },
  { id: "my-list", label: "My List", needsAuth: true, group: "Lists" },
];

describe("HomeSourcePicker", () => {
  it("shows the selected option label on the trigger", () => {
    render(<HomeSourcePicker value="discover" options={options} signedIn onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Discover" })).toBeTruthy();
  });

  it("falls back to a placeholder label when nothing is selected", () => {
    render(<HomeSourcePicker value="" options={options} signedIn onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Choose a feed or list" })).toBeTruthy();
  });

  it("opens the popover and lists options grouped by section", () => {
    const { container } = render(<HomeSourcePicker value="discover" options={options} signedIn onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    const groups = Array.from(container.querySelectorAll<HTMLElement>(".home-picker-group")).map(
      (node) => node.textContent,
    );
    expect(groups).toContain("Feeds");
    expect(groups).toContain("Lists");
    expect(groups).toContain("Following");
  });

  it("filters options as you type", () => {
    render(<HomeSourcePicker value="discover" options={options} signedIn onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    const input = screen.getByRole("combobox");
    fireEvent.input(input, { target: { value: "my list" } });
    const list = screen.getByRole("listbox");
    expect(within(list).getByText("My List")).toBeTruthy();
    expect(within(list).queryByText("Discover")).toBeNull();
  });

  it("commits the clicked option and closes the popover", () => {
    const onChange = vi.fn();
    render(<HomeSourcePicker value="discover" options={options} signedIn onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    fireEvent.click(screen.getByText("My List"));
    expect(onChange).toHaveBeenCalledWith("my-list");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("appends a sign-in hint to auth-required options when signed out", () => {
    render(<HomeSourcePicker value="discover" options={options} signedIn={false} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    expect(screen.getByText("Following (needs sign-in)")).toBeTruthy();
  });
});
