import { useEffect } from "react";
import type {
  ColumnSchema,
  ReportFooterRow,
  ReportLink,
  ReportOutputNode,
} from "@sapporta/shared/contracts";

interface ReportGridProps {
  nodes: ReportOutputNode[];
  levelColumns: Record<string, ColumnSchema[]>;
  levelName?: string;
  footerRows?: ReportFooterRow[];
  levelOptions?: Record<string, { defaultCollapsed?: boolean }>;
  levelLinks?: Record<string, ReportLink[]>;
}

export function ReportGrid(props: ReportGridProps) {
  useEffect(() => {
    console.log("[sapporta] report grid renderer stub", {
      levelName: props.levelName,
      rowCount: props.nodes.length,
      nodes: props.nodes,
      levelColumns: props.levelColumns,
      footerRows: props.footerRows,
      levelOptions: props.levelOptions,
      levelLinks: props.levelLinks,
    });
  }, [
    props.levelName,
    props.nodes,
    props.levelColumns,
    props.footerRows,
    props.levelOptions,
    props.levelLinks,
  ]);

  return (
    <div className="h-full p-4 text-sap-body text-sap-muted">
      Report grid rendering is temporarily disabled while the old grid renderer
      is removed. Result data has been logged to the console.
    </div>
  );
}
