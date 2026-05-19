import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PaginationProps {
  page: number;
  pages: number;
  onPageChange: (page: number) => void;
}

/**
 * Compact flat pagination strip. Sits at the bottom of a table view just
 * above the global status bar. Mono page numbers, no button chrome — the
 * arrow buttons are bare icons with a hover tint.
 */
export function Pagination({ page, pages, onPageChange }: PaginationProps) {
  if (pages <= 1) return null;

  return (
    <div className="h-sap-header shrink-0 flex items-center justify-center gap-[10px] border-t border-sap-border bg-sap-chip">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="flex items-center justify-center w-[20px] h-[20px] rounded-[3px] text-sap-subtle hover:text-sap-fg hover:bg-sap-row-hover disabled:opacity-40 disabled:pointer-events-none"
        aria-label="Previous page"
      >
        <ChevronLeft className="h-[14px] w-[14px]" />
      </button>
      <span className="mono text-sap-meta text-sap-muted">
        {page} / {pages}
      </span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onPageChange(page + 1)}
        className="flex items-center justify-center w-[20px] h-[20px] rounded-[3px] text-sap-subtle hover:text-sap-fg hover:bg-sap-row-hover disabled:opacity-40 disabled:pointer-events-none"
        aria-label="Next page"
      >
        <ChevronRight className="h-[14px] w-[14px]" />
      </button>
    </div>
  );
}
