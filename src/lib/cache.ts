import { useRef } from "react";

// A real cache layer for the App's keyed in-memory data caches (feed / profile /
// search / thread / metadata). Replaces the previous bare `useRef<Record<K, V>>`
// objects whose reads/writes/invalidations were spread across App.tsx by hand
// (see issue #18 item 2). The implementation is a plain Map; the interface is
// the abstraction a query layer (e.g. TanStack Query) could later slot in
// behind without touching the call sites.
export interface Cache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  keys(): string[];
  entries(): Array<[string, T]>;
  readonly size: number;
}

export function createCache<T>(entries?: Record<string, T>): Cache<T> {
  const store = new Map<string, T>();
  if (entries) {
    for (const key of Object.keys(entries)) {
      store.set(key, entries[key]);
    }
  }
  return {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value);
    },
    has: (key) => store.has(key),
    delete: (key) => store.delete(key),
    clear: () => store.clear(),
    keys: () => [...store.keys()],
    entries: () => [...store.entries()],
    get size() {
      return store.size;
    },
  };
}

// Stable per-component-instance cache: the instance is created on first render
// and kept in a ref so reads/writes from effects and callbacks (which must not
// retrigger renders) behave exactly like the old mutable Record refs.
export function useCache<T>(initializer?: () => Cache<T>): Cache<T> {
  const cacheRef = useRef<Cache<T> | null>(null);
  if (cacheRef.current === null) {
    cacheRef.current = initializer ? initializer() : createCache<T>();
  }
  return cacheRef.current;
}
