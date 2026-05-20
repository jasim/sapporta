import { useEffect, useId, useMemo, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PaginationProps {
  page: number;
  pages: number;
  onPageChange: (page: number) => void;
  hrefForPage?: (page: number) => string;
}

export type PaginationRangeItem = number | "ellipsis";

const SIBLING_PAGE_COUNT = 4;
const MIN_PAGE_SLOT_DIGITS = 4;

function clampPage(page: number, pages: number): number {
  if (pages <= 0) return 1;
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), pages);
}

function pageRange(from: number, to: number): number[] {
  const pages: number[] = [];
  for (let pageNumber = from; pageNumber <= to; pageNumber += 1) {
    pages.push(pageNumber);
  }
  return pages;
}

export function visiblePaginationItems(
  page: number,
  pages: number,
  siblingCount = SIBLING_PAGE_COUNT,
): PaginationRangeItem[] {
  const safePages = Math.max(0, Math.trunc(pages));
  if (safePages === 0) return [];

  const current = clampPage(page, safePages);
  const from = Math.max(1, current - siblingCount);
  const to = Math.min(safePages, current + siblingCount);
  const visible = new Set<number>([1, safePages, ...pageRange(from, to)]);

  const ordered = Array.from(visible).sort((a, b) => a - b);
  const result: PaginationRangeItem[] = [];

  for (const pageNumber of ordered) {
    const previous = result[result.length - 1];
    if (typeof previous === "number") {
      const gap = pageNumber - previous;
      if (gap === 2) {
        result.push(previous + 1);
      } else if (gap > 2) {
        result.push("ellipsis");
      }
    }
    result.push(pageNumber);
  }

  return result;
}

/**
 * Dense table pagination strip. Keeps the bottom bar compact while exposing
 * generous targets for adjacent-page movement, direct page links around the
 * current position, and an editable page jump field.
 */
export function Pagination({
  page,
  pages,
  onPageChange,
  hrefForPage,
}: PaginationProps) {
  const pageJumpId = useId();
  const [draftPage, setDraftPage] = useState(String(page));
  const pageItems = useMemo(
    () => visiblePaginationItems(page, pages),
    [page, pages],
  );
  const pageSlotDigits = Math.max(
    MIN_PAGE_SLOT_DIGITS,
    String(Math.max(1, pages)).length,
  );
  const pageSlotStyle = {
    minWidth: `calc(${pageSlotDigits}ch + 20px)`,
  };

  useEffect(() => {
    setDraftPage(String(page));
  }, [page]);

  if (pages <= 1) return null;

  const safePage = clampPage(page, pages);

  function goToPage(nextPage: number): void {
    const clamped = clampPage(nextPage, pages);
    setDraftPage(String(clamped));
    if (clamped !== page) onPageChange(clamped);
  }

  function handleLinkClick(
    event: MouseEvent<HTMLAnchorElement>,
    nextPage: number,
  ): void {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    goToPage(nextPage);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = Number.parseInt(draftPage, 10);
    goToPage(Number.isNaN(parsed) ? page : parsed);
  }

  return (
    <nav
      aria-label="Table pages"
      className="min-h-[56px] shrink-0 flex flex-wrap items-center justify-between gap-x-6 gap-y-[6px] border-t border-sap-border bg-sap-surface px-4 py-[6px]"
    >
      <div className="flex shrink-0 items-center gap-[12px]">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => goToPage(safePage - 1)}
          className="flex h-11 min-w-[84px] shrink-0 items-center justify-center gap-[5px] rounded-[6px] border border-sap-border-soft bg-sap-surface px-[12px] text-sap-emph text-sap-soft hover:bg-sap-row-hover hover:text-sap-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
          <span>Prev</span>
        </button>

        <span className="h-6 border-l border-sap-border" aria-hidden="true" />

        <form
          onSubmit={handleSubmit}
          className="flex shrink-0 items-center gap-[6px] text-sap-meta text-sap-muted"
        >
          <label htmlFor={pageJumpId}>Page</label>
          <input
            id={pageJumpId}
            value={draftPage}
            onChange={(event) => setDraftPage(event.target.value)}
            onBlur={() => setDraftPage(String(safePage))}
            inputMode="numeric"
            aria-label={`Page number, 1 through ${pages}`}
            className="mono h-9 w-[64px] rounded-[5px] border border-sap-border bg-sap-surface px-[9px] text-center text-sap-meta text-sap-fg shadow-[inset_0_0_0_1px_var(--sap-border-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <span>of {pages}</span>
        </form>

        <span className="h-6 border-l border-sap-border" aria-hidden="true" />

        <button
          type="button"
          disabled={safePage >= pages}
          onClick={() => goToPage(safePage + 1)}
          className="flex h-11 min-w-[84px] shrink-0 items-center justify-center gap-[5px] rounded-[6px] border border-sap-border-soft bg-sap-surface px-[12px] text-sap-emph text-sap-soft hover:bg-sap-row-hover hover:text-sap-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
          aria-label="Next page"
        >
          <span>Next</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <ol className="ml-auto flex min-w-0 max-w-full flex-1 items-center justify-end gap-[3px] overflow-x-auto">
        {pageItems.map((item, index) => {
          if (item === "ellipsis") {
            return (
              <li
                key={`ellipsis-${index}`}
                className="mono flex h-9 items-center justify-center rounded-[5px] px-[10px] text-sap-meta text-sap-muted"
                style={pageSlotStyle}
                aria-hidden="true"
              >
                ...
              </li>
            );
          }

          const isCurrent = item === safePage;
          const className = [
            "mono flex h-9 min-w-9 items-center justify-center rounded-[5px] px-[10px] text-sap-meta focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isCurrent
              ? "border border-sap-border-strong bg-sap-surface text-sap-fg"
              : "text-sap-muted hover:bg-sap-row-hover hover:text-sap-fg",
          ].join(" ");

          return (
            <li key={item}>
              {hrefForPage ? (
                <a
                  href={hrefForPage(item)}
                  aria-current={isCurrent ? "page" : undefined}
                  aria-label={
                    isCurrent ? `Page ${item}` : `Go to page ${item}`
                  }
                  onClick={(event) => handleLinkClick(event, item)}
                  className={className}
                  style={pageSlotStyle}
                >
                  {item}
                </a>
              ) : (
                <button
                  type="button"
                  aria-current={isCurrent ? "page" : undefined}
                  aria-label={
                    isCurrent ? `Page ${item}` : `Go to page ${item}`
                  }
                  onClick={() => goToPage(item)}
                  className={className}
                  style={pageSlotStyle}
                >
                  {item}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
