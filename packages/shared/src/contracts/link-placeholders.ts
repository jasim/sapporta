/**
 * `{column}` placeholder syntax for `kind: "url"` nav links. The href of a
 * url link may embed placeholders that are substituted with the current
 * row's values. This module is the single definition of that syntax:
 * validation asks which columns an href references, resolution substitutes
 * their values.
 */

const PLACEHOLDER = /\{([^{}]+)\}/g;

/** Column names referenced by `{column}` placeholders in a url link href. */
export function hrefPlaceholderColumns(href: string): string[] {
  return [...href.matchAll(PLACEHOLDER)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/**
 * Substitutes `{column}` placeholders with URL-encoded row values; null
 * when a referenced value is absent, so the caller withholds the link
 * instead of emitting a half-formed href.
 */
export function substituteHrefPlaceholders(
  href: string,
  values: Readonly<Record<string, unknown>>,
): string | null {
  let missing = false;
  const substituted = href.replace(PLACEHOLDER, (_, column: string) => {
    const value = values[column];
    if (value === null || value === undefined) {
      missing = true;
      return "";
    }
    return encodeURIComponent(String(value));
  });
  return missing ? null : substituted;
}
