export function defaultColumnLabel(columnName: string): string {
  const base = columnName.endsWith("_id")
    ? columnName.slice(0, -"_id".length)
    : columnName;
  return humanizeIdentifier(base);
}

export function humanizeIdentifier(identifier: string): string {
  const words = identifier
    .split("_")
    .filter((part) => part.length > 0)
    .join(" ");
  if (words.length === 0) return identifier;
  return words[0].toLocaleUpperCase() + words.slice(1);
}

/**
 * Title-cases a snake_case identifier: `JOURNAL_ENTRIES` and
 * `journal_entries` both become `Journal Entries`.
 */
export function titleCaseIdentifier(identifier: string): string {
  const words = identifier
    .split("_")
    .filter((part) => part.length > 0)
    .map((word) => {
      const lower = word.toLocaleLowerCase();
      return lower[0].toLocaleUpperCase() + lower.slice(1);
    });
  if (words.length === 0) return identifier;
  return words.join(" ");
}
