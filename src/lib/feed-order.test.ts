import { describe, expect, it } from "vitest";
import { orderBySavedOrder } from "./feed-order";

type Feed = { uri: string; label: string };

const feed = (uri: string, label = uri): Feed => ({ uri, label });

describe("orderBySavedOrder", () => {
  it("returns the input unchanged (same reference) when no manual order is saved", () => {
    const feeds = [feed("a"), feed("b"), feed("c")];
    const result = orderBySavedOrder(feeds, []);
    expect(result).toBe(feeds);
  });

  it("sorts feeds by their position in the saved order", () => {
    const feeds = [feed("a"), feed("b"), feed("c")];
    const result = orderBySavedOrder(feeds, ["c", "a", "b"]);
    expect(result.map((f) => f.uri)).toEqual(["c", "a", "b"]);
  });

  it("does not mutate the input array", () => {
    const feeds = [feed("a"), feed("b"), feed("c")];
    const before = feeds.map((f) => f.uri);
    orderBySavedOrder(feeds, ["c", "b", "a"]);
    expect(feeds.map((f) => f.uri)).toEqual(before);
  });

  it("places feeds missing from the saved order at the end, keeping their relative order", () => {
    // 'b' was subscribed after the last manual reorder, so it has no rank.
    const feeds = [feed("a"), feed("b"), feed("c")];
    const result = orderBySavedOrder(feeds, ["c", "a"]);
    expect(result.map((f) => f.uri)).toEqual(["c", "a", "b"]);
  });

  it("keeps all unranked feeds in their original relative order (stable sort)", () => {
    const feeds = [feed("x"), feed("y"), feed("z")];
    // Only 'z' is ranked; x and y are unranked and must stay x-before-y.
    const result = orderBySavedOrder(feeds, ["z"]);
    expect(result.map((f) => f.uri)).toEqual(["z", "x", "y"]);
  });

  it("ignores saved-order URIs that are not currently subscribed", () => {
    const feeds = [feed("a"), feed("b")];
    const result = orderBySavedOrder(feeds, ["ghost", "b", "a"]);
    expect(result.map((f) => f.uri)).toEqual(["b", "a"]);
  });

  it("handles an empty feed list", () => {
    expect(orderBySavedOrder([], ["a", "b"])).toEqual([]);
  });

  it("orders a realistic mix of ranked and newly-subscribed feeds", () => {
    const feeds = [feed("at://1"), feed("at://2"), feed("at://3"), feed("at://4")];
    // Saved order from a prior reorder only covered 1 and 3; 2 and 4 are new.
    const result = orderBySavedOrder(feeds, ["at://3", "at://1"]);
    expect(result.map((f) => f.uri)).toEqual(["at://3", "at://1", "at://2", "at://4"]);
  });
});
