import { parseCanonicalInstant, parsePlainDate } from "@sapporta/shared/temporal";
import type { DisplayType } from "./column-types";

// Format a canonical date/timestamp string for display. Parses through
// Temporal rather than `new Date()` — the latter reinterprets a date-only
// ISO string as midnight UTC and then renders it in the browser's local
// zone, which silently shifts the day across zone boundaries. That's the
// exact trap DATA-TYPE-PRINCIPLES forbids ("no Date, no dayjs").
function formatDateValue(value: string): string {
  try {
    return parsePlainDate(value).toString();
  } catch {}
  try {
    return parseCanonicalInstant(value).toString({ smallestUnit: "second" });
  } catch {
    return value;
  }
}

export function formatCellValue(value: unknown, type: DisplayType): string {
  if (value === null || value === undefined) return "";

  switch (type) {
    case "checkbox":
      return value ? "Yes" : "No";
    case "date":
      return typeof value === "string" ? formatDateValue(value) : String(value);
    case "currency": {
      if (typeof value !== "number") return String(value);
      return value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    case "percentage": {
      if (typeof value !== "number") return String(value);
      return `${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
    }
    case "number":
      return typeof value === "number" ? value.toLocaleString() : String(value);
    default:
      return String(value);
  }
}

export function parseCellInput(input: string, type: DisplayType): unknown {
  if (input === "") return null;

  switch (type) {
    case "currency":
    case "percentage":
    case "number": {
      // No coercion — DATA-TYPE-PRINCIPLES §4 forbids it everywhere
      // downstream of the boundary. `"$95k"` is not a number; reject by
      // returning the raw string so validation can fail loudly instead
      // of silently accepting a stripped fragment.
      const n = Number(input);
      if (!Number.isFinite(n)) return input;
      return n;
    }
    case "checkbox":
      return input === "true" || input === "1";
    case "pk":
    case "fk":
    case "select":
    case "date":
    case "text":
      return input;
    default:
      throw new Error(`parseCellInput: unhandled DisplayType ${JSON.stringify(type)}`);
  }
}
