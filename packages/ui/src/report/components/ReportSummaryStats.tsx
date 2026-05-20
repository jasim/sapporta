import type { ReactNode } from "react";
import { cn } from "@/ui/utils/cn";

export interface ReportStat {
  /** Short uppercase label (e.g. "Opening balance"). */
  label: string;
  /** The value. Rendered in mono — caller pre-formats numbers. */
  value: ReactNode;
  /** One of the semantic accents. Defaults to `fg`. */
  tone?: "fg" | "positive" | "negative" | "brand" | "muted";
  /** Bolder weight, used for the "answer" cell (closing balance, total). */
  strong?: boolean;
}

export interface ReportSummaryStatsProps {
  stats: ReportStat[];
}

/**
 * Opt-in 4-up (or N-up) summary strip for reports — the one place a report
 * UI "shouts". Renders evenly-spaced stat cards inside a report frame:
 * small uppercase label on top, large mono value below.
 *
 * Apps pass this (populated from a report's rollup) into `ReportView`'s
 * `summary` prop. Framework-generic — `tone` maps to the semantic accent
 * tokens (positive/negative/brand) so non-accounting apps can use the
 * same primitive.
 */
export function ReportSummaryStats({ stats }: ReportSummaryStatsProps) {
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}
    >
      {stats.map((s, i) => (
        <div
          key={i}
          className={cn(
            "px-[14px] py-[10px]",
            i < stats.length - 1 && "border-r border-sap-border",
          )}
        >
          <div className="text-sap-micro font-medium uppercase tracking-sap-label text-sap-subtle">
            {s.label}
          </div>
          <div
            className={cn(
              "mono text-sap-display tracking-sap-display mt-[2px]",
              s.strong ? "font-semibold" : "font-medium",
              s.tone === "positive"
                ? "text-sap-positive"
                : s.tone === "negative"
                  ? "text-sap-negative"
                  : s.tone === "brand"
                    ? "text-sap-brand"
                    : s.tone === "muted"
                      ? "text-sap-muted"
                      : "text-sap-fg",
            )}
          >
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
