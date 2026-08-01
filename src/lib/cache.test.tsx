import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { createCache, useCache } from "./cache";

describe("createCache", () => {
  it("starts empty", () => {
    const cache = createCache<string>();
    expect(cache.size).toBe(0);
    expect(cache.get("k")).toBeUndefined();
    expect(cache.has("k")).toBe(false);
    expect(cache.keys()).toEqual([]);
    expect(cache.entries()).toEqual([]);
  });

  it("round-trips set/get and reports has/size/keys/entries", () => {
    const cache = createCache<string>();
    cache.set("a", "1");
    cache.set("b", "2");
    expect(cache.get("a")).toBe("1");
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.has("b")).toBe(true);
    expect(cache.size).toBe(2);
    expect(cache.keys()).toEqual(["a", "b"]);
    expect(cache.entries()).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
  });

  it("overwrites the previous value on duplicate set without growing", () => {
    const cache = createCache<number>();
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(2);
  });

  it("delete removes a single key and reports whether it was present", () => {
    const cache = createCache<number>();
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.size).toBe(1);
  });

  it("clear empties the cache", () => {
    const cache = createCache<number>();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.keys()).toEqual([]);
    expect(cache.get("a")).toBeUndefined();
  });

  it("seeds from an initial entries record", () => {
    const cache = createCache<number>({ a: 1, b: 2 });
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
    expect(cache.size).toBe(2);
  });
});

describe("useCache", () => {
  it("returns a stable instance across re-renders", () => {
    const instances: Array<ReturnType<typeof useCache<number>>> = [];
    function Harness() {
      const cache = useCache<number>();
      instances.push(cache);
      const [count, setCount] = useState(0);
      return (
        <button type="button" onClick={() => setCount((v) => v + 1)}>
          {count}
        </button>
      );
    }
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(instances).toHaveLength(3);
    expect(instances[0]).toBe(instances[1]);
    expect(instances[0]).toBe(instances[2]);
    unmount();
  });

  it("runs the initializer once to seed entries", () => {
    const initializer = vi.fn(() => createCache<number>({ a: 42 }));
    function Harness() {
      const cache = useCache<number>(initializer);
      const [count, setCount] = useState(0);
      return (
        <button type="button" onClick={() => setCount((v) => v + 1)}>
          {count} {cache.get("a") ?? "none"}
        </button>
      );
    }
    const { unmount } = render(<Harness />);
    expect(screen.getByRole("button").textContent).toBe("0 42");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("1 42");
    expect(initializer).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("gives each component instance its own cache", () => {
    const sizes: number[] = [];
    function Harness({ seed }: { seed: number }) {
      const cache = useCache<number>();
      sizes.push(cache.size);
      cache.set("x", seed);
      sizes.push(cache.size);
      return <div>{seed}</div>;
    }
    render(<Harness seed={1} />);
    render(<Harness seed={2} />);
    // Each instance started empty (0) and then held one entry (1),
    // independently — the first instance's entry is invisible to the second.
    expect(sizes).toEqual([0, 1, 0, 1]);
  });
});
