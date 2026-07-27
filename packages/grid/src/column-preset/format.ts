import { finiteNumericValue } from "./numeric";

export function formatText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function formatNumber(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const number = finiteNumericValue(value);
  return number === null
    ? String(value)
    : new Intl.NumberFormat().format(number);
}

export function formatCurrency(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const number = finiteNumericValue(value);
  return number !== null
    ? new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(number)
    : String(value);
}

export function formatPercentage(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const number = finiteNumericValue(value);
  return number !== null
    ? new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(number)
    : String(value);
}

export function formatDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}
