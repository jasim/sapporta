export function parseText(value: string): unknown {
  return value;
}

export function parseNumber(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const normalized = trimmed.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : value;
}

export function parseBoolean(value: string): unknown {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return Boolean(value);
}

export function parseDate(value: string): unknown {
  return value.trim() === "" ? null : value;
}
