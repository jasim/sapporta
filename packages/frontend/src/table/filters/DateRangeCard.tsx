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
import type { FilterCondition, NewFilterCondition } from "@sapporta/shared/filter";
import { Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui";
import { Input } from "@sapporta/ui";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { inferFilterColumnType } from "./column-catalog";

/** A date-range pair. `gte` is always the lower bound, `lte` the upper. */
export interface DateRange {
  column: ColumnSchema;
  gte: FilterCondition & { op: "gte"; value: string };
  lte: FilterCondition & { op: "lte"; value: string };
}

/** Row in the cards bar — either a single condition or a date range. */
export type CardEntry =
  | { kind: "single"; condition: FilterCondition }
  | { kind: "range"; range: DateRange };

/**
 * Scan a condition list and fold each matched `gte`+`lte` pair on the same
 * date column into one `range` entry. The output preserves the original
 * order of appearance — a range sits where its first member was. Anything
 * that doesn't participate in a range becomes a `single` entry. Pure.
 */
export function groupDateRanges(
  filters: FilterCondition[],
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
    if (!col || inferFilterColumnType(col) !== "date") {
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
  onUpdate: (id: string, patch: NewFilterCondition) => void;
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

  function removeBoth() {
    onRemove(gte.id);
    onRemove(lte.id);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="inline-flex items-stretch h-sap-ctl rounded-[5px] border border-sap-border overflow-hidden">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-[6px] px-[10px] bg-sap-surface hover:bg-sap-row-hover text-sap-fg text-sap-emph"
          >
            <span className="text-sap-muted">{label}</span>
            <span className="text-sap-subtle">between</span>
            <span className="font-medium">
              {gte.value || "…"} – {lte.value || "…"}
            </span>
          </button>
        </PopoverTrigger>
        <button
          type="button"
          aria-label={`Remove ${label} range filter`}
          onClick={removeBoth}
          className="flex items-center px-[8px] bg-sap-surface hover:bg-sap-row-hover text-sap-muted hover:text-sap-fg border-l border-sap-border"
        >
          <X className="h-[11px] w-[11px]" />
        </button>
      </div>
      <PopoverContent align="start" sideOffset={4} className="p-[12px] w-[280px]">
        <div className="flex flex-col gap-[10px]">
          <FieldLabel label="From">
            <Input
              type="date"
              value={gte.value}
              onChange={(e) =>
                onUpdate(gte.id, {
                  column: column.name,
                  op: "gte",
                  value: e.target.value,
                })
              }
              className="h-sap-ctl"
            />
          </FieldLabel>
          <FieldLabel label="To">
            <Input
              type="date"
              value={lte.value}
              onChange={(e) =>
                onUpdate(lte.id, {
                  column: column.name,
                  op: "lte",
                  value: e.target.value,
                })
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
