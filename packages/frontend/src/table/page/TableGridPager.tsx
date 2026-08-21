import type {
  TGridLevelId,
  TGridRowsByLevel,
} from "../tgrid/tgrid-types";
import type { TGridSession } from "../tgrid/tgrid-session";
import type { TablePageMode } from "./table-page-mode";
import { useTableLevelPager } from "./table-level-pager";
import {
  CompactTablePager,
  NumberedTablePager,
  type TablePagerDirection,
} from "./TablePagers";
import type { TableGridPagerButtonRefs } from "./table-grid-pager-boundary";
import { focusTableGrid } from "./table-grid-pager-boundary";
export {
  focusTableGridPagerBoundary,
  focusTableGrid,
  type TableGridPagerButtonRefs,
} from "./table-grid-pager-boundary";

export function TableGridPager<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>({
  mode,
  session,
  level,
  routePath,
  buttonRefs,
  onPagerButtonActivate,
  onPagerBoundaryExit,
}: {
  mode: TablePageMode;
  session: TGridSession<RowsByLevel, AppServices>;
  level: TGridLevelId<RowsByLevel>;
  routePath: string;
  buttonRefs?: TableGridPagerButtonRefs;
  onPagerButtonActivate?: (direction: TablePagerDirection) => boolean;
  onPagerBoundaryExit?: () => void;
}) {
  const pager = useTableLevelPager(session, level, routePath);
  const returnFocusToGrid = () => {
    onPagerBoundaryExit?.();
    focusTableGrid(session.runtime);
    return true;
  };

  if (pager.pages <= 1) return null;
  return mode === "narrowCards" ? (
    <CompactTablePager
      {...pager}
      previousButtonRef={buttonRefs?.previous}
      nextButtonRef={buttonRefs?.next}
      onPagerButtonActivate={onPagerButtonActivate}
      onPagerArrowKey={returnFocusToGrid}
      onPagerBoundaryExit={onPagerBoundaryExit}
    />
  ) : (
    <NumberedTablePager
      {...pager}
      previousButtonRef={buttonRefs?.previous}
      nextButtonRef={buttonRefs?.next}
      onPagerButtonActivate={onPagerButtonActivate}
      onPagerArrowKey={returnFocusToGrid}
      onPagerBoundaryExit={onPagerBoundaryExit}
    />
  );
}
