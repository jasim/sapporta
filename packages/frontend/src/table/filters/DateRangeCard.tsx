/**
 * DateRangeCard — one card that internally edits two conditions.
 *
 * The server grammar has no `between` operator; a date range is expressed
 * as `col >= start AND col <= end`. Shown as two independent cards, that
 * reads badly ("date on or after X", "date on or before Y"). This
 * component groups a matched `gte` + `lte` pair on a date column into a
 * single card and exposes two date pickers behind one popover. The
 * catalog and controller don't need to know — this is purely a cards-bar
 * presentation detail.
 */

import { useState } from "react";
import { X } from "lucide-react";
import type { TypedFilterCondition } from "@sapporta/shared/filter";
import {
  encodeTypedValue,
  materializeTypedFilterCondition,
} from "@sapporta/shared/filter";
import { Input } from "@sapporta/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui/popover";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { inferDisplayType } from "../model/column-types";
import { dateInputConditionValue, dateInputValue } from "./date-filter-value";

/** A date-range pair. `gte` is always the lower bound, `lte` the upper. */
export interface DateRange {
  column: ColumnSchema;
  gte: TypedFilterCondition & { op: "gte" };
  lte: TypedFilterCondition & { op: "lte" };
}

/** Row in the cards bar — either a single condition or a date range. */
export type CardEntry =
  | { kind: "single"; condition: TypedFilterCondition }
  | { kind: "range"; range: DateRange };

/**
 * Scan a condition list and fold each matched `gte`+`lte` pair on the same
 * date column into one `range` entry. The output preserves the original
 * order of appearance — a range sits where its first member was. Anything
 * that doesn't participate in a range becomes a `single` entry. Pure.
 */
export function groupDateRanges(
  filters: TypedFilterCondition[],
  columnsByName: Map<string, ColumnSchema>,
): CardEntry[] {
  const claimed = new Set<string>();
  const out: CardEntry[] = [];
  for (const cond of filters) {
    if (claimed.has(cond.id)) continue;
    if (cond.op !== "gte" && cond.op !== "lte") {
      out.push({ kind: "single", condition: cond });
      continue;
    }
    const col = columnsByName.get(cond.column);
    const displayType = col ? inferDisplayType(col) : null;
    if (!col || (displayType !== "date" && displayType !== "timestamp")) {
      out.push({ kind: "single", condition: cond });
      continue;
    }
    const pairOp = cond.op === "gte" ? "lte" : "gte";
    const partner = filters.find(
      (f) =>
        !claimed.has(f.id) &&
        f.id !== cond.id &&
        f.column === cond.column &&
        f.op === pairOp,
    );
    if (!partner || (partner.op !== "gte" && partner.op !== "lte")) {
      out.push({ kind: "single", condition: cond });
      continue;
    }
    claimed.add(cond.id);
    claimed.add(partner.id);
    const gte = cond.op === "gte" ? cond : partner;
    const lte = cond.op === "lte" ? cond : partner;
    out.push({
      kind: "range",
      range: {
        column: col,
        gte: gte as DateRange["gte"],
        lte: lte as DateRange["lte"],
      },
    });
  }
  return out;
}

export interface DateRangeCardProps {
  range: DateRange;
  onUpdate: (id: string, patch: TypedFilterCondition) => void;
  onRemove: (id: string) => void;
}

export function DateRangeCard({
  range,
  onUpdate,
  onRemove,
}: DateRangeCardProps) {
  const [open, setOpen] = useState(false);
  const { column, gte, lte } = range;
  const label = column.label;
  // Both ends read as the calendar day the reader sees, on the chip and in
  // the pickers alike. A timestamp column stores instants, so its bounds are
  // translated at this boundary rather than shown in their stored form.
  const gteValue = dateInputValue(column, encodeTypedValue(gte.value));
  const lteValue = dateInputValue(column, encodeTypedValue(lte.value));

  function removeBoth() {
    onRemove(gte.id);
    onRemove(lte.id);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="inline-flex h-sap-ctl max-w-full items-stretch overflow-hidden rounded-[5px] border border-sap-border">
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex min-w-0 items-center gap-[6px] bg-sap-surface px-[10px] text-sap-emph text-sap-fg hover:bg-sap-row-hover"
            />
          }
        >
          <span className="truncate text-sap-muted">{label}</span>
          <span className="shrink-0 text-sap-subtle">between</span>
          <span className="truncate font-medium">
            {gteValue || "…"} – {lteValue || "…"}
          </span>
        </PopoverTrigger>
        <button
          type="button"
          aria-label={`Remove ${label} range filter`}
          onClick={removeBoth}
          className="flex shrink-0 items-center border-l border-sap-border bg-sap-surface px-[8px] text-sap-muted hover:bg-sap-row-hover hover:text-sap-fg"
        >
          <X className="h-[11px] w-[11px]" />
        </button>
      </div>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="p-[12px] w-[280px]"
      >
        <div className="flex flex-col gap-[10px]">
          <FieldLabel label="From">
            <Input
              type="date"
              value={gteValue}
              onChange={(e) =>
                onUpdate(
                  gte.id,
                  materializeTypedFilterCondition(
                    {
                      column: column.name,
                      op: "gte",
                      value: dateInputConditionValue(
                        column,
                        "gte",
                        e.target.value,
                      ),
                    },
                    { columns: [column] },
                    gte.id,
                  ),
                )
              }
              className="h-sap-ctl"
            />
          </FieldLabel>
          <FieldLabel label="To">
            <Input
              type="date"
              value={lteValue}
              onChange={(e) =>
                onUpdate(
                  lte.id,
                  materializeTypedFilterCondition(
                    {
                      column: column.name,
                      op: "lte",
                      value: dateInputConditionValue(
                        column,
                        "lte",
                        e.target.value,
                      ),
                    },
                    { columns: [column] },
                    lte.id,
                  ),
                )
              }
              className="h-sap-ctl"
            />
          </FieldLabel>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-[4px]">
      <span className="text-sap-label uppercase tracking-sap-head font-medium text-sap-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}
