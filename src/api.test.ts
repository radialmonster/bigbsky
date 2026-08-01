// Behavioral tests for the `resolveHandle` browser-local cache in api.ts. These
// exercise the real shipped function (fetch mocked) to lock in the cache
// contract: DIDs pass through without a lookup, successful handle resolutions
// are cached for the TTL window, the entry re-resolves once the TTL lapses, and
// writes sweep expired entries so the Map stays bounded over a long session.
//
// Each test uses a unique handle because the cache is module-level state that
// persists across tests within this file.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getActorFeeds, getActorLists, getRecordEmbed, resolveHandle } from "./api";

const NOW = new Date("2026-06-27T12:00:00.000Z").getTime();
const TTL_MS = 5 * 60 * 1000;

let fetchMock: ReturnType<typeof vi.fn>;

// Minimal Response stand-in: getJson only reads `ok` and `json()`.
function didResponse(did: string) {
  return { ok: true, json: async () => ({ did }) } as unknown as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("resolveHandle", () => {
  it("returns a DID unchanged without any network lookup", async () => {
    const did = "did:plc:passthrough0000000000000";
    await expect(resolveHandle(did)).resolves.toBe(did);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches a successful resolution for the TTL window (one fetch for repeats)", async () => {
    const handle = "cache-hit.test";
    const did = "did:plc:cachehit000000000000000";
    fetchMock.mockResolvedValue(didResponse(did));

    await expect(resolveHandle(handle)).resolves.toBe(did);
    // Second call just before the TTL lapses is served from cache.
    vi.setSystemTime(NOW + TTL_MS - 1);
    await expect(resolveHandle(handle)).resolves.toBe(did);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-resolves once the cached entry has expired", async () => {
    const handle = "expiry.test";
    fetchMock
      .mockResolvedValueOnce(didResponse("did:plc:expiry111111111111111111"))
      .mockResolvedValueOnce(didResponse("did:plc:expiry222222222222222222"));

    await expect(resolveHandle(handle)).resolves.toBe("did:plc:expiry111111111111111111");
    // Past the TTL: the stale entry is ignored and a fresh lookup runs, picking
    // up the handle's new DID (handles can be reassigned).
    vi.setSystemTime(NOW + TTL_MS + 1);
    await expect(resolveHandle(handle)).resolves.toBe("did:plc:expiry222222222222222222");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed resolutions", async () => {
    const handle = "failure.test";
    fetchMock
      .mockResolvedValueOnce({ ok: false, statusText: "NotFound", json: async () => ({}) } as unknown as Response)
      .mockResolvedValueOnce(didResponse("did:plc:recovered00000000000000"));

    await expect(resolveHandle(handle)).rejects.toBeTruthy();
    // The first attempt threw, so nothing was cached; the retry hits the network.
    await expect(resolveHandle(handle)).resolves.toBe("did:plc:recovered00000000000000");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a typed ApiError (not a raw SyntaxError) on a malformed 2xx body", async () => {
    const handle = "malformed-body.test";
    // A 2xx whose body fails to decode (empty/truncated stream, proxy 200 +
    // empty). The success-path guard must surface the same ApiError shape callers
    // handle for the error path, not a raw SyntaxError.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    } as unknown as Response);

    await expect(resolveHandle(handle)).rejects.toBeInstanceOf(ApiError);
    // The malformed attempt threw, so nothing was cached; a retry hits the network.
    fetchMock.mockResolvedValueOnce(didResponse("did:plc:malformedok00000000000"));
    await expect(resolveHandle(handle)).resolves.toBe("did:plc:malformedok00000000000");
  });

  it("sweeps expired entries on write so the cache stays bounded", async () => {
    // Resolve one handle, let it expire, then resolve a second handle. The
    // second write sweeps the first (now-expired) entry. We assert the live
    // entry survives the sweep (still served from cache) while the swept one
    // re-resolves — i.e. the sweep only drops expired entries.
    const stale = "sweep-stale.test";
    const fresh = "sweep-fresh.test";
    fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("sweep-stale.test")) return didResponse("did:plc:sweepstale0000000000000");
      return didResponse("did:plc:sweepfresh0000000000000");
    });

    await resolveHandle(stale);
    vi.setSystemTime(NOW + TTL_MS + 1);
    // This write sweeps the now-expired `stale` entry and caches `fresh`.
    await resolveHandle(fresh);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The just-written live entry is served from cache (no new fetch).
    await resolveHandle(fresh);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest live entries once over the hard cap (bounded within a TTL window)", async () => {
    // All resolutions stay live (no time advance), so the expiry sweep frees
    // nothing. Resolve more distinct handles than the cap; the earliest one must
    // be evicted by insertion order and thus re-resolve on next access.
    fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const handle = url.searchParams.get("handle") ?? "";
      return didResponse(`did:plc:cap${handle.replace(/\D/g, "").padStart(24, "0")}`);
    });

    const CAP = 500;
    // First handle — this is the oldest entry and should be evicted once we
    // exceed the cap.
    await resolveHandle("cap-0.test");
    const callsAfterFirst = fetchMock.mock.calls.length;
    // Fill past the cap with fresh distinct handles (all still live).
    for (let i = 1; i <= CAP; i += 1) {
      await resolveHandle(`cap-${i}.test`);
    }

    // cap-0 was the oldest live entry, so it was evicted and now re-resolves.
    const before = fetchMock.mock.calls.length;
    await resolveHandle("cap-0.test");
    expect(fetchMock.mock.calls.length).toBe(before + 1);
    // A recently-inserted handle is still cached (no extra fetch).
    const before2 = fetchMock.mock.calls.length;
    await resolveHandle(`cap-${CAP}.test`);
    expect(fetchMock.mock.calls.length).toBe(before2);
    expect(callsAfterFirst).toBe(1);
  });
});

describe("getRecordEmbed", () => {
  const wrap = (record: unknown) => ({ record });

  it("returns a renderable viewRecord (has author + value)", () => {
    const record = {
      $type: "app.bsky.embed.record#viewRecord",
      uri: "at://did:plc:x/app.bsky.feed.post/1",
      cid: "cid1",
      author: { did: "did:plc:x", handle: "a.test" },
      value: { text: "hi" },
    };
    expect(getRecordEmbed(wrap(record))).toBe(record);
  });

  it("drops the viewNotFound variant (carries uri but no content)", () => {
    expect(
      getRecordEmbed(
        wrap({ $type: "app.bsky.embed.record#viewNotFound", uri: "at://x/y/1", notFound: true }),
      ),
    ).toBeNull();
  });

  it("drops the viewBlocked variant", () => {
    expect(
      getRecordEmbed(
        wrap({ $type: "app.bsky.embed.record#viewBlocked", uri: "at://x/y/1", blocked: true }),
      ),
    ).toBeNull();
  });

  it("drops the viewDetached variant", () => {
    expect(
      getRecordEmbed(
        wrap({ $type: "app.bsky.embed.record#viewDetached", uri: "at://x/y/1", detached: true }),
      ),
    ).toBeNull();
  });

  it("keeps a feed-generator record view (uri, no author, not a not-found/blocked type)", () => {
    const record = {
      $type: "app.bsky.feed.defs#generatorView",
      uri: "at://did:plc:x/app.bsky.feed.generator/g",
    };
    expect(getRecordEmbed(wrap(record))).toBe(record);
  });

  it("unwraps a recordWithMedia container (record.record)", () => {
    const inner = {
      $type: "app.bsky.embed.record#viewRecord",
      uri: "at://x/y/1",
      author: { did: "did:plc:x", handle: "a.test" },
    };
    expect(getRecordEmbed({ record: { record: inner } })).toBe(inner);
  });

  it("returns null for non-object / missing record", () => {
    expect(getRecordEmbed(null)).toBeNull();
    expect(getRecordEmbed({})).toBeNull();
    expect(getRecordEmbed(wrap({ notAUri: true }))).toBeNull();
  });
});

describe("paged profile surface readers", () => {
  function emptyFeeds() {
    return { ok: true, json: async () => ({ feeds: [], cursor: undefined }) } as unknown as Response;
  }

  function emptyLists() {
    return { ok: true, json: async () => ({ lists: [], cursor: undefined }) } as unknown as Response;
  }

  it("getActorFeeds forwards an optional cursor param to the XRPC query", async () => {
    fetchMock.mockResolvedValueOnce(emptyFeeds());
    await getActorFeeds("a.test", 50, undefined, "cursor-1");
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toMatch(/app\.bsky\.feed\.getActorFeeds$/);
    expect(url.searchParams.get("cursor")).toBe("cursor-1");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("getActorFeeds omits the cursor param when none is provided", async () => {
    fetchMock.mockResolvedValueOnce(emptyFeeds());
    await getActorFeeds("a.test", 50);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.has("cursor")).toBe(false);
  });

  it("getActorLists forwards an optional cursor param to the XRPC query", async () => {
    fetchMock.mockResolvedValueOnce(emptyLists());
    await getActorLists("a.test", 50, undefined, "cursor-2");
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toMatch(/app\.bsky\.graph\.getLists$/);
    expect(url.searchParams.get("cursor")).toBe("cursor-2");
    expect(url.searchParams.get("limit")).toBe("50");
  });
});
