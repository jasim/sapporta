import type { ColumnWidth } from "./types";

export type CharacterColumnSizing = {
  width?: number;
  minWidth?: number;
  maxWidth?: number;
};

function chCalc(value: number): string {
  return `calc(${value}ch + 1rem)`;
}

export function columnPresetWidthForSizing(
  sizing: CharacterColumnSizing,
): ColumnWidth | undefined {
  if (sizing.width != null) {
    return { track: chCalc(sizing.width) };
  }
  if (sizing.minWidth != null || sizing.maxWidth != null) {
    const min = sizing.minWidth != null ? chCalc(sizing.minWidth) : "0";
    const max = sizing.maxWidth != null ? chCalc(sizing.maxWidth) : "1fr";
    return { track: `minmax(${min}, ${max})` };
  }
  return undefined;
}
