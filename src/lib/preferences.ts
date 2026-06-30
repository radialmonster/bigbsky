// Pure parsers for browser-persisted preference blobs.
//
// Each takes the raw stored JSON string (or `null` when the key is absent — the
// shape `safeLocalStorageGet` / `safeSessionStorageGet` return) and yields a
// validated value, never throwing. Malformed, missing, or wrong-typed data
// degrades to an empty default. Keeping the parse/validate step pure (no
// storage access of its own) lets it be unit-tested directly and reused by the
// thin `read*` wrappers in App.tsx without re-implementing the guard each time.

// Array of strings; drops any non-string entries. With `limit`, keeps only the
// first N (the persisted lists are intentionally capped).
export function parseStringArray(raw: string | null, limit?: number): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const strings = parsed.filter((value): value is string => typeof value === "string");
    return typeof limit === "number" ? strings.slice(0, limit) : strings;
  } catch {
    return [];
  }
}

// Like parseStringArray but also drops blank/whitespace-only entries (the
// original, untrimmed string is kept when it has non-whitespace content).
export function parseNonEmptyStringArray(raw: string | null, limit?: number): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const strings = parsed.filter((value): value is string => typeof value === "string" && value.trim() !== "");
    return typeof limit === "number" ? strings.slice(0, limit) : strings;
  } catch {
    return [];
  }
}

// Object map of string -> boolean; drops any entry whose value isn't a boolean.
export function parseBooleanRecord(raw: string | null): Record<string, boolean> {
  try {
    const parsed = JSON.parse(raw ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const result: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

// Object map of string -> finite number; drops non-finite values (NaN,
// Infinity, non-numbers) and non-string keys.
export function parseFiniteNumberRecord(raw: string | null): Record<string, number> {
  try {
    const parsed = JSON.parse(raw ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[0] === "string" && Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}
