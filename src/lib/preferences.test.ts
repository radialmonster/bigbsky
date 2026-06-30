import { describe, expect, it } from "vitest";
import {
  parseBooleanRecord,
  parseFiniteNumberRecord,
  parseNonEmptyStringArray,
  parseStringArray,
} from "./preferences";

describe("parseStringArray", () => {
  it("returns [] for null (absent key)", () => {
    expect(parseStringArray(null)).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseStringArray("{not json")).toEqual([]);
  });

  it("returns [] for a non-array JSON value", () => {
    expect(parseStringArray('{"a":1}')).toEqual([]);
    expect(parseStringArray("null")).toEqual([]);
    expect(parseStringArray('"x"')).toEqual([]);
  });

  it("keeps strings and drops non-string entries", () => {
    expect(parseStringArray('["a", 1, "b", null, true, "c"]')).toEqual(["a", "b", "c"]);
  });

  it("preserves blank strings (no trimming)", () => {
    expect(parseStringArray('["", "  ", "x"]')).toEqual(["", "  ", "x"]);
  });

  it("does not slice when no limit is given", () => {
    const raw = JSON.stringify(["a", "b", "c", "d"]);
    expect(parseStringArray(raw)).toEqual(["a", "b", "c", "d"]);
  });

  it("applies the limit to the first N entries", () => {
    const raw = JSON.stringify(["a", "b", "c", "d"]);
    expect(parseStringArray(raw, 2)).toEqual(["a", "b"]);
  });
});

describe("parseNonEmptyStringArray", () => {
  it("returns [] for null / malformed / non-array", () => {
    expect(parseNonEmptyStringArray(null)).toEqual([]);
    expect(parseNonEmptyStringArray("nope")).toEqual([]);
    expect(parseNonEmptyStringArray('{"a":1}')).toEqual([]);
  });

  it("drops blank and whitespace-only entries, keeps the original (untrimmed) value", () => {
    expect(parseNonEmptyStringArray('["a", "", "  ", " b ", 2, null]')).toEqual(["a", " b "]);
  });

  it("applies the limit after filtering", () => {
    expect(parseNonEmptyStringArray('["a", "", "b", "c"]', 2)).toEqual(["a", "b"]);
  });
});

describe("parseBooleanRecord", () => {
  it("returns {} for null / malformed / non-object", () => {
    expect(parseBooleanRecord(null)).toEqual({});
    expect(parseBooleanRecord("nope")).toEqual({});
    expect(parseBooleanRecord("null")).toEqual({});
    expect(parseBooleanRecord("[1,2]")).toEqual({});
  });

  it("keeps boolean values and drops everything else", () => {
    expect(parseBooleanRecord('{"a": true, "b": false, "c": 1, "d": "true", "e": null}')).toEqual({
      a: true,
      b: false,
    });
  });
});

describe("parseFiniteNumberRecord", () => {
  it("returns {} for null / malformed / non-object", () => {
    expect(parseFiniteNumberRecord(null)).toEqual({});
    expect(parseFiniteNumberRecord("nope")).toEqual({});
    expect(parseFiniteNumberRecord("null")).toEqual({});
  });

  it("keeps finite numbers and drops non-finite / non-number values", () => {
    // NaN/Infinity can't survive JSON, but a stray string/bool/null can.
    expect(parseFiniteNumberRecord('{"feed:a": 120, "feed:b": 0, "feed:c": "x", "feed:d": null, "feed:e": true}')).toEqual({
      "feed:a": 120,
      "feed:b": 0,
    });
  });

  it("preserves negative and fractional offsets", () => {
    expect(parseFiniteNumberRecord('{"a": -5, "b": 12.5}')).toEqual({ a: -5, b: 12.5 });
  });
});
