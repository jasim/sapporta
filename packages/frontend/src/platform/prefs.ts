// Generic localStorage round-trip for user-visual preferences (theme, grid
// widths, sidebar collapsed, etc.). JSON-serializable values only; callers
// with non-JSON shapes (Map, Set, Date) convert at the boundary.

type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function loadPref<T extends JsonValue>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function savePref<T extends JsonValue>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}
