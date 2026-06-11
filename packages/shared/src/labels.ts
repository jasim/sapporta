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
