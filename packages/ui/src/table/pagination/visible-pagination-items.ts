export type PaginationRangeItem = number | "ellipsis";

const SIBLING_PAGE_COUNT = 4;

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
