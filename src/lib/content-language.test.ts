import { describe, expect, it } from "vitest";
import type { FeedItem, FeedPost } from "../api";
import {
  baseLangCode,
  code3ToCode2,
  declaredPostLanguages,
  filterFeedByLanguages,
  itemMatchesLanguages,
  postMatchesLanguages,
  postNeedsDetection,
  postsNeedingDetection,
} from "./content-language";

// Minimal FeedPost factory: only the fields the filter reads.
function makePost(uri: string, opts: { langs?: string[]; text?: string } = {}): FeedPost {
  return {
    uri,
    cid: `${uri}-cid`,
    author: { did: `did:${uri}`, handle: `${uri}.test` },
    record: {
      ...(opts.text !== undefined ? { text: opts.text } : {}),
      ...(opts.langs !== undefined ? { langs: opts.langs } : {}),
    },
  } as FeedPost;
}

function makeItem(post: FeedPost, reply?: { parent?: FeedPost; root?: FeedPost }): FeedItem {
  return { post, ...(reply ? { reply } : {}) };
}

const NONE = new Map<string, string>();

describe("code3ToCode2", () => {
  it("maps known 639-3 codes to 639-1", () => {
    expect(code3ToCode2("eng")).toBe("en");
    expect(code3ToCode2("spa")).toBe("es");
    expect(code3ToCode2("por")).toBe("pt");
    expect(code3ToCode2("deu")).toBe("de");
    expect(code3ToCode2("jpn")).toBe("ja");
  });

  it("passes through 2-letter codes and unknown codes unchanged", () => {
    expect(code3ToCode2("en")).toBe("en");
    expect(code3ToCode2("xxx")).toBe("xxx");
  });

  it("normalizes case before the lowercase lookup table", () => {
    expect(code3ToCode2("ENG")).toBe("en");
    expect(code3ToCode2("Spa")).toBe("es");
    expect(code3ToCode2("JPN")).toBe("ja");
  });
});

describe("baseLangCode", () => {
  it("lowercases and strips the region subtag", () => {
    expect(baseLangCode("en-US")).toBe("en");
    expect(baseLangCode("PT-BR")).toBe("pt");
    expect(baseLangCode("ja")).toBe("ja");
  });
});

describe("declaredPostLanguages", () => {
  it("normalizes declared langs to base codes", () => {
    expect(declaredPostLanguages(makePost("a", { langs: ["en-US", "PT"] }))).toEqual(["en", "pt"]);
  });

  it("returns [] when langs is absent or not an array", () => {
    expect(declaredPostLanguages(makePost("a"))).toEqual([]);
    expect(declaredPostLanguages(makePost("a", { langs: undefined }))).toEqual([]);
  });

  it("drops non-string entries", () => {
    const post = { uri: "a", cid: "c", author: { did: "d", handle: "h" }, record: { langs: ["en", 5, null] } } as unknown as FeedPost;
    expect(declaredPostLanguages(post)).toEqual(["en"]);
  });
});

describe("postNeedsDetection", () => {
  it("is true only for untagged posts that have text", () => {
    expect(postNeedsDetection(makePost("a", { text: "hello" }))).toBe(true);
    expect(postNeedsDetection(makePost("a", { text: "hi", langs: ["en"] }))).toBe(false);
    expect(postNeedsDetection(makePost("a", { text: "   " }))).toBe(false);
    expect(postNeedsDetection(makePost("a"))).toBe(false);
  });
});

describe("postMatchesLanguages", () => {
  it("empty selection (Any) matches everything", () => {
    expect(postMatchesLanguages(makePost("a", { langs: ["ja"], text: "x" }), [])).toBe(true);
  });

  it("matches on declared languages (base-code, region-insensitive)", () => {
    expect(postMatchesLanguages(makePost("a", { langs: ["en-US"] }), ["en"])).toBe(true);
    expect(postMatchesLanguages(makePost("a", { langs: ["es"] }), ["en"])).toBe(false);
  });

  it("matches a multi-declared post if any declared language is selected", () => {
    expect(postMatchesLanguages(makePost("a", { langs: ["en", "es"] }), ["es"])).toBe(true);
  });

  it("keeps text-less posts even when they declare nothing", () => {
    expect(postMatchesLanguages(makePost("a"), ["en"])).toBe(true);
  });

  it("uses the detected language for untagged posts with text", () => {
    const post = makePost("a", { text: "hola mundo" });
    expect(postMatchesLanguages(post, ["es"], "es")).toBe(true);
    expect(postMatchesLanguages(post, ["en"], "es")).toBe(false);
  });

  it("keeps untagged posts whose detection is still pending", () => {
    expect(postMatchesLanguages(makePost("a", { text: "hola" }), ["en"])).toBe(true);
  });
});

describe("itemMatchesLanguages", () => {
  it("keeps a row if the reply parent matches even when the post doesn't", () => {
    const item = makeItem(
      makePost("reply", { langs: ["ja"] }),
      { parent: makePost("parent", { langs: ["en"] }) },
    );
    expect(itemMatchesLanguages(item, ["en"], NONE)).toBe(true);
  });

  it("drops a row when no post in it matches", () => {
    const item = makeItem(makePost("a", { langs: ["ja"] }));
    expect(itemMatchesLanguages(item, ["en"], NONE)).toBe(false);
  });
});

describe("filterFeedByLanguages", () => {
  const english = makeItem(makePost("en1", { langs: ["en"] }));
  const spanish = makeItem(makePost("es1", { langs: ["es"] }));
  const untaggedNoText = makeItem(makePost("img", {}));

  it("returns the same reference for an empty selection (Any)", () => {
    const items = [english, spanish];
    expect(filterFeedByLanguages(items, [], NONE)).toBe(items);
  });

  it("keeps only matching rows (plus always-kept text-less posts)", () => {
    const result = filterFeedByLanguages([english, spanish, untaggedNoText], ["en"], NONE);
    expect(result).toEqual([english, untaggedNoText]);
  });

  it("never blanks: returns the unfiltered feed if the filter empties it", () => {
    const items = [spanish];
    expect(filterFeedByLanguages(items, ["en"], NONE)).toBe(items);
  });

  it("returns an empty array only when the input was already empty", () => {
    expect(filterFeedByLanguages([], ["en"], NONE)).toEqual([]);
  });
});

describe("postsNeedingDetection", () => {
  it("returns distinct untagged-with-text posts across post and reply context", () => {
    const items = [
      makeItem(makePost("a", { text: "hello" }), { parent: makePost("b", { text: "hi" }) }),
      makeItem(makePost("a", { text: "hello" })), // duplicate uri -> deduped
      makeItem(makePost("c", { langs: ["en"], text: "tagged" })), // declared -> skip
      makeItem(makePost("d", {})), // no text -> skip
    ];
    expect(postsNeedingDetection(items, ["en"], NONE).map((p) => p.uri).sort()).toEqual(["a", "b"]);
  });

  it("skips posts already in the detection cache", () => {
    const cache = new Map([["a", "en"]]);
    const items = [makeItem(makePost("a", { text: "hello" }))];
    expect(postsNeedingDetection(items, ["en"], cache)).toEqual([]);
  });

  it("returns nothing for an empty selection (Any)", () => {
    const items = [makeItem(makePost("a", { text: "hello" }))];
    expect(postsNeedingDetection(items, [], NONE)).toEqual([]);
  });
});
