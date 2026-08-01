import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useDismissMenu } from "../common/useDismissMenu";

export type HomeOption = { id: string; label: string; needsAuth: boolean; group: "Following" | "Feeds" | "Lists" };

// Searchable replacement for the old native <select> Home-page picker. A native
// dropdown doesn't scale once a user has many feeds and lists, so this filters
// as you type and groups results by Following / Feeds / Lists. Keyboard: type to
// filter, Up/Down to move, Enter to choose, Escape to close.
export function HomeSourcePicker({
  value,
  options,
  signedIn,
  onChange,
}: {
  value: string;
  options: HomeOption[];
  signedIn: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selected = options.find((option) => option.id === value);
  const optionLabel = (option: HomeOption) =>
    `${option.label}${option.needsAuth && !signedIn ? " (needs sign-in)" : ""}`;
  const buttonLabel = selected ? optionLabel(selected) : "Choose a feed or list";

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return options;
    }
    return options.filter((option) => `${option.label} ${option.group}`.toLowerCase().includes(trimmed));
  }, [options, query]);

  // Group the filtered options while preserving their original order.
  const groups = useMemo(() => {
    const order: HomeOption["group"][] = ["Following", "Feeds", "Lists"];
    return order
      .map((group) => ({ group, items: filtered.filter((option) => option.group === group) }))
      .filter((entry) => entry.items.length > 0);
  }, [filtered]);

  // Close on outside click (Escape is handled inline in onKeyDown, which also
  // clears the filter query).
  useDismissMenu(containerRef, open, () => setOpen(false));

  // When opening (or as the filter changes), focus the input and point the
  // active highlight at the current selection, clamping into range.
  useEffect(() => {
    if (!open) {
      return;
    }
    inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    const selectedIndex = filtered.findIndex((option) => option.id === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [filtered, value]);

  const commit = (option: HomeOption | undefined) => {
    if (!option) {
      return;
    }
    onChange(option.id);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  };

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (!open || !listRef.current) {
      return;
    }
    const node = listRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  return (
    <div className="home-picker" ref={containerRef}>
      <button
        type="button"
        className="home-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{buttonLabel}</span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <div className="home-picker-popover">
          <div className="home-picker-search">
            <Search size={15} aria-hidden />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls="home-picker-list"
              aria-autocomplete="list"
              placeholder="Search feeds and lists"
              value={query}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <ul className="home-picker-list" id="home-picker-list" role="listbox" ref={listRef}>
            {filtered.length === 0 ? (
              <li className="home-picker-empty" role="presentation">
                No matches
              </li>
            ) : (
              groups.map((entry) => (
                <li key={entry.group} role="presentation">
                  <div className="home-picker-group" role="presentation">
                    {entry.group}
                  </div>
                  <ul role="presentation">
                    {entry.items.map((option) => {
                      const index = filtered.indexOf(option);
                      const isSelected = option.id === value;
                      return (
                        <li
                          key={option.id}
                          data-index={index}
                          role="option"
                          aria-selected={isSelected}
                          className={`home-picker-option${index === activeIndex ? " active" : ""}`}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => commit(option)}
                        >
                          <span>{optionLabel(option)}</span>
                          {isSelected && <Check size={15} aria-hidden />}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
