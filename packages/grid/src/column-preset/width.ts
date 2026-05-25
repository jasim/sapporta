import type { ColumnSchema } from "../grid/types/schema";
import { preset } from "./preset";
import type { ColumnWidth } from "./types";

export function trackForColumn(column: ColumnSchema): string {
  return trackForWidth(preset(column)?.layout.width);
}

export function templateColumns(columns: readonly ColumnSchema[]): string {
  return columns.map(trackForColumn).join(" ");
}

function trackForWidth(width: ColumnWidth | undefined): string {
  if (!width) return "minmax(0, 1fr)";
  if (typeof width === "object" && "track" in width) return width.track;
  if (typeof width === "object") {
    const min = width.min ?? 0;
    const max = width.max ?? width.ideal;
    return `minmax(${min}px, ${max === undefined ? "1fr" : `${max}px`})`;
  }
  switch (width) {
    case "compact":
      return "minmax(48px, max-content)";
    case "content":
      return "max-content";
    case "fill":
      return "minmax(0, 1fr)";
    case "numeric":
      return "minmax(80px, 112px)";
    case "date":
      return "minmax(112px, 128px)";
    case "enum":
      return "minmax(96px, max-content)";
    case "foreignKey":
      return "minmax(144px, 220px)";
  }
}
