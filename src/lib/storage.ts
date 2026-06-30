// Best-effort Web Storage helpers shared across the app.
//
// Every browser-storage access can throw — private-mode quota limits, blocked
// third-party storage, or a SecurityError when cookies/storage are disabled —
// so each call is wrapped in try/catch. Reads degrade to `null`; writes/removes
// report success as a boolean (callers that don't care can ignore it). These
// are intentionally tiny and pure-of-side-effects-on-failure so they can be
// unit-tested and reused by App.tsx, auth.ts, etc. without re-implementing the
// guard in each module.

export function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeLocalStorageSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeLocalStorageRemove(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function safeSessionStorageRemove(key: string): boolean {
  try {
    sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
