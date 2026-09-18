import { MAX_PAGE_SIZE } from "@sapporta/shared/contracts";
import type { TGridLevelPagination } from "./tgrid-level-config";

export type TGridPageWindow = {
  page: number;
  pageSize: number;
};

// The page a level reads for a requested page. A level that reads all its rows
// reads the first page at the largest page size the table API accepts. Query
// state and row requests both go through this, so they name the same page.
export function tgridPageWindow(
  pagination: TGridLevelPagination,
  requested: TGridPageWindow,
): TGridPageWindow {
  return pagination === "all"
    ? { page: 1, pageSize: MAX_PAGE_SIZE }
    : requested;
}
