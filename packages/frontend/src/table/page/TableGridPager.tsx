import type {
  TGridLevelId,
  TGridRowsByLevel,
} from "@/table/grid-adapter/tgrid-types";
import type { TGridSession } from "@/table/state/tgrid-session";
import type { TablePageMode } from "./table-page-mode";
import { useTableLevelPager } from "./table-level-pager";
import { CompactTablePager, NumberedTablePager } from "./TablePagers";

export function TableGridPager<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>({
  mode,
  session,
  level,
  routePath,
}: {
  mode: TablePageMode;
  session: TGridSession<RowsByLevel, AppServices>;
  level: TGridLevelId<RowsByLevel>;
  routePath: string;
}) {
  const pager = useTableLevelPager(session, level, routePath);

  if (pager.pages <= 1) return null;
  return mode === "narrowCards" ? (
    <CompactTablePager {...pager} />
  ) : (
    <NumberedTablePager {...pager} />
  );
}
