import { useState } from "react";
import type { CellRenderProps } from "../../core/types/schema";
import type { DatePreset, TimestampPreset } from "../preset";
import type { ColumnPresetCellRenderRuntime } from "../runtime";
import { describeInstant } from "../format";

/**
 * A date or timestamp cell.
 *
 * The text stops at the minute so that the column stays scannable, which
 * leaves the seconds and the time zone unsaid. Both live in a tooltip, and
 * both are resolved on first hover rather than on render: describing an
 * instant costs a time-zone resolution per value, and a grid renders far more
 * cells than a reader ever points at.
 */
export function DateCell({
  value,
  rawValue,
  preset,
}: Omit<CellRenderProps, "value"> & {
  value: string;
  rawValue: unknown;
  runtime: ColumnPresetCellRenderRuntime;
  preset: DatePreset | TimestampPreset;
}) {
  const [described, setDescribed] = useState<{
    value: unknown;
    text: string;
  } | null>(null);

  // Held against the value it describes, so a cell scrolled onto a different
  // row does not keep the previous row's tooltip until the next hover.
  const title =
    described !== null && Object.is(described.value, rawValue)
      ? described.text
      : undefined;

  function describeOnHover() {
    if (title !== undefined) return;
    const text = describeInstant(rawValue);
    if (text !== undefined) setDescribed({ value: rawValue, text });
  }

  return (
    <span
      className="mono text-sap-data text-sap-muted truncate"
      title={title}
      onMouseEnter={preset.kind === "timestamp" ? describeOnHover : undefined}
    >
      {value}
    </span>
  );
}
