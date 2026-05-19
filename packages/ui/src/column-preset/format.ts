export function formatText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function formatNumber(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat().format(n) : String(value);
}

export function formatCurrency(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
      }).format(n)
    : String(value);
}

export function formatPercentage(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(n)
    : String(value);
}

export function formatDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

