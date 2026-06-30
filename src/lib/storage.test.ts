import { afterEach, describe, expect, it, vi } from "vitest";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
  safeSessionStorageRemove,
} from "./storage";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("safeLocalStorage*", () => {
  it("round-trips a value through set/get", () => {
    expect(safeLocalStorageSet("k", "v")).toBe(true);
    expect(safeLocalStorageGet("k")).toBe("v");
  });

  it("returns null for a missing key", () => {
    expect(safeLocalStorageGet("absent")).toBeNull();
  });

  it("removes a value", () => {
    safeLocalStorageSet("k", "v");
    expect(safeLocalStorageRemove("k")).toBe(true);
    expect(safeLocalStorageGet("k")).toBeNull();
  });

  it("returns null (not throw) when getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(safeLocalStorageGet("k")).toBeNull();
  });

  it("returns false (not throw) when setItem throws (e.g. quota)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(safeLocalStorageSet("k", "v")).toBe(false);
  });

  it("returns false (not throw) when removeItem throws", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(safeLocalStorageRemove("k")).toBe(false);
  });
});

describe("safeSessionStorageRemove", () => {
  it("removes a session value", () => {
    sessionStorage.setItem("s", "1");
    expect(safeSessionStorageRemove("s")).toBe(true);
    expect(sessionStorage.getItem("s")).toBeNull();
  });

  it("returns false (not throw) when sessionStorage.removeItem throws", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(safeSessionStorageRemove("s")).toBe(false);
  });
});
