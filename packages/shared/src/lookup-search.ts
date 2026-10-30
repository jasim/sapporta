/**
 * Whether a lookup entry matches what is typed: the text, trimmed and
 * ignoring case, inside the entry's label or inside one of its displayed
 * `fields` in `meta`. Empty text matches every entry.
 *
 * This is the rule a lookup search follows wherever it runs. The server
 * states it in SQL for `lookup` in `@sapporta/server`, and a test there runs
 * both over the same rows; a search in the browser calls this function.
 */
export function lookupEntryMatches(
  entry: { label: string; meta?: unknown },
  searchText: string,
  fields: readonly string[],
): boolean {
  const text = searchText.trim().toLocaleLowerCase();
  if (text === "") return true;
  if (entry.label.toLocaleLowerCase().includes(text)) return true;
  const meta = entry.meta;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return false;
  }
  return fields.some((field) => {
    const value: unknown = Reflect.get(meta, field);
    return (
      (typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint") &&
      String(value).toLocaleLowerCase().includes(text)
    );
  });
}
