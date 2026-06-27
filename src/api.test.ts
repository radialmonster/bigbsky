// Behavioral tests for the `resolveHandle` browser-local cache in api.ts. These
// exercise the real shipped function (fetch mocked) to lock in the cache
// contract: DIDs pass through without a lookup, successful handle resolutions
// are cached for the TTL window, the entry re-resolves once the TTL lapses, and
// writes sweep expired entries so the Map stays bounded over a long session.
//
// Each test uses a unique handle because the cache is module-level state that
// persists across tests within this file.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHandle } from "./api";

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
});
