import { useEffect, useId, useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent, MouseEvent, Ref } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { visiblePaginationItems } from "../tgrid/visible-pagination-items";
import type { TableLevelPager } from "./table-level-pager";
import { clampPage, parsePageJump } from "./table-pager-math";

const MIN_PAGE_SLOT_DIGITS = 4;

export type TablePagerDirection = "before" | "after";

type TablePagerProps = TableLevelPager & {
  previousButtonRef?: Ref<HTMLButtonElement>;
  nextButtonRef?: Ref<HTMLButtonElement>;
  onPagerButtonActivate?: (direction: TablePagerDirection) => boolean;
  onPagerArrowKey?: () => boolean;
  onPagerBoundaryExit?: () => void;
};

export function NumberedTablePager({
  page,
  pages,
  onPageChange,
  hrefForPage,
  previousButtonRef,
  nextButtonRef,
  onPagerButtonActivate,
  onPagerArrowKey,
  onPagerBoundaryExit,
}: TablePagerProps) {
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

  function goToPage(nextPage: number, direction?: TablePagerDirection): void {
    if (direction && onPagerButtonActivate?.(direction)) return;
    onPagerBoundaryExit?.();
    const clamped = clampPage(nextPage, pages);
    setDraftPage(String(clamped));
    if (clamped !== page) {
      onPageChange(clamped);
    }
  }

  function commitPageJump(): void {
    const parsed = parsePageJump(draftPage, pages);
    if (parsed === undefined) {
      setDraftPage(String(safePage));
      return;
    }
    goToPage(parsed);
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
    commitPageJump();
  }

  return (
    <nav
      aria-label="Table pages"
      className="min-h-[56px] shrink-0 flex flex-wrap items-center justify-between gap-x-6 gap-y-[6px] border-t border-sap-border bg-sap-surface px-4 py-[6px]"
    >
      <div className="flex shrink-0 items-center gap-[12px]">
        <button
          ref={previousButtonRef}
          type="button"
          disabled={safePage <= 1}
          onClick={() => goToPage(safePage - 1, "before")}
          onKeyDown={(event) =>
            handlePagerBoundaryKey(event, "before", onPagerArrowKey)
          }
          onBlur={onPagerBoundaryExit}
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
            onBlur={commitPageJump}
            inputMode="numeric"
            aria-label={`Page number, 1 through ${pages}`}
            className="mono h-9 w-[64px] rounded-[5px] border border-sap-border bg-sap-surface px-[9px] text-center text-sap-meta text-sap-fg shadow-[inset_0_0_0_1px_var(--sap-border-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <span>of {pages}</span>
        </form>

        <span className="h-6 border-l border-sap-border" aria-hidden="true" />

        <button
          ref={nextButtonRef}
          type="button"
          disabled={safePage >= pages}
          onClick={() => goToPage(safePage + 1, "after")}
          onKeyDown={(event) =>
            handlePagerBoundaryKey(event, "after", onPagerArrowKey)
          }
          onBlur={onPagerBoundaryExit}
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
                  aria-label={isCurrent ? `Page ${item}` : `Go to page ${item}`}
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
                  aria-label={isCurrent ? `Page ${item}` : `Go to page ${item}`}
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

export function CompactTablePager({
  page,
  pages,
  onPageChange,
  previousButtonRef,
  nextButtonRef,
  onPagerButtonActivate,
  onPagerArrowKey,
  onPagerBoundaryExit,
}: TablePagerProps) {
  const pageJumpId = useId();
  const safePage = clampPage(page, pages);
  const [draftPage, setDraftPage] = useState(String(safePage));

  useEffect(() => {
    setDraftPage(String(safePage));
  }, [safePage]);

  if (pages <= 1) return null;

  function goToPage(nextPage: number, direction?: TablePagerDirection): void {
    if (direction && onPagerButtonActivate?.(direction)) return;
    onPagerBoundaryExit?.();
    const clamped = clampPage(nextPage, pages);
    setDraftPage(String(clamped));
    if (clamped !== page) {
      onPageChange(clamped);
    }
  }

  function commitPageJump(): void {
    const parsed = parsePageJump(draftPage, pages);
    if (parsed === undefined) {
      setDraftPage(String(safePage));
      return;
    }
    goToPage(parsed);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    commitPageJump();
  }

  return (
    <nav
      aria-label="Table pages"
      className="grid min-h-[44px] shrink-0 grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-1.5 border-t border-sap-border bg-sap-surface px-2 py-0.5"
    >
      <button
        ref={previousButtonRef}
        type="button"
        disabled={safePage <= 1}
        onClick={() => goToPage(safePage - 1, "before")}
        onKeyDown={(event) =>
          handlePagerBoundaryKey(event, "before", onPagerArrowKey)
        }
        onBlur={onPagerBoundaryExit}
        className="flex h-10 w-10 items-center justify-center rounded-[6px] border border-sap-border-soft bg-sap-surface text-sap-soft hover:bg-sap-row-hover hover:text-sap-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <form
        aria-label="Page jump"
        onSubmit={handleSubmit}
        className="mx-auto flex min-w-0 items-center justify-center gap-2 text-sap-meta text-sap-muted"
      >
        <label htmlFor={pageJumpId} className="sr-only">
          Page
        </label>
        <input
          id={pageJumpId}
          value={draftPage}
          onChange={(event) => setDraftPage(event.target.value)}
          onBlur={commitPageJump}
          inputMode="numeric"
          aria-label={`Page number, 1 through ${pages}`}
          className="mono h-9 w-[58px] rounded-[5px] border border-sap-border bg-sap-surface px-2 text-center text-sap-meta text-sap-fg shadow-[inset_0_0_0_1px_var(--sap-border-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span className="whitespace-nowrap">of {pages}</span>
      </form>

      <button
        ref={nextButtonRef}
        type="button"
        disabled={safePage >= pages}
        onClick={() => goToPage(safePage + 1, "after")}
        onKeyDown={(event) =>
          handlePagerBoundaryKey(event, "after", onPagerArrowKey)
        }
        onBlur={onPagerBoundaryExit}
        className="flex h-10 w-10 items-center justify-center rounded-[6px] border border-sap-border-soft bg-sap-surface text-sap-soft hover:bg-sap-row-hover hover:text-sap-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

function handlePagerBoundaryKey(
  event: KeyboardEvent<HTMLButtonElement>,
  buttonDirection: TablePagerDirection,
  onPagerArrowKey: (() => boolean) | undefined,
): void {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    !onPagerArrowKey
  ) {
    return;
  }

  const keyDirection =
    event.key === "ArrowUp" || event.key === "PageUp"
      ? "before"
      : event.key === "ArrowDown" || event.key === "PageDown"
        ? "after"
        : undefined;

  // Row navigation parks on Next or Previous at a page boundary. Repeating the
  // outward Arrow/Page key must keep focus parked here and suppress document
  // scrolling; activating the button changes pages, while the opposite
  // direction returns focus to the boundary row in the grid.
  if (keyDirection === buttonDirection) {
    event.preventDefault();
    return;
  }

  if (
    keyDirection === undefined &&
    event.key !== "ArrowLeft" &&
    event.key !== "ArrowRight"
  ) {
    return;
  }

  if (!onPagerArrowKey()) return;
  event.preventDefault();
}
