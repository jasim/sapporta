import { useEffect, useState } from "react";

/**
 * Returns `value` after it has stayed unchanged for `delayMs`.
 * Each change to `value` resets the timer, so rapid updates collapse
 * into a single trailing-edge emission.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
