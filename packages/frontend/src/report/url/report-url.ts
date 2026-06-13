import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export type UrlQueryValue = string | number | boolean | null | undefined;
export type UrlQueryObject = Record<string, UrlQueryValue>;

export function buildSearchParams(values: UrlQueryObject): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  return params;
}

export function createSnapshotUrl(
  path: string,
  values: UrlQueryObject,
): string {
  const query = buildSearchParams(values).toString();
  return query ? `${path}?${query}` : path;
}

export function useUrlQueryState<TState extends Record<string, string>>(
  defaults: TState,
): [TState, (next: Partial<TState>) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => {
    const next = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const value = searchParams.get(key);
      if (value !== null)
        next[key as keyof TState] = value as TState[keyof TState];
    }
    return next;
  }, [defaults, searchParams]);

  const setState = useCallback(
    (next: Partial<TState>) => {
      setSearchParams(buildSearchParams({ ...state, ...next }), {
        replace: true,
      });
    },
    [setSearchParams, state],
  );

  return [state, setState];
}
