import type { LoadedRowsBoundaryEvent, SourceLoadResult } from "@sapporta/grid";
import type {
  TGridLevelId,
  TGridRowsByLevel,
} from "../grid-adapter/tgrid-types";
import type { TGridSession } from "./tgrid-session";

// Standard table-page policy for keyboard navigation beyond loaded rows.
// Custom table compositions can replace this handler while continuing to use
// the same session and grid runtime.
export function paginateTGridLoadedRowsBoundary<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>(
  event: LoadedRowsBoundaryEvent,
  levelId: TGridLevelId<RowsByLevel>,
  session: TGridSession<RowsByLevel, AppServices>,
): Promise<SourceLoadResult> | false {
  const level = session.levels[levelId];
  const queryOwner =
    level.config.query?.owner ??
    (levelId === session.rootLevel ? "host" : "source");
  if (queryOwner !== "host") return false;

  const query = session.getQueryState(levelId);
  if (!Number.isFinite(query.pageSize)) return false;

  const nextPage =
    event.direction === "after" ? query.page + 1 : query.page - 1;
  if (nextPage < 1) return false;

  const sourceState = session.runtime.level(event.loadPath).data.state();
  if (sourceState.status !== "ready") return false;
  if (
    event.direction === "after" &&
    query.totalCount !== null &&
    query.page * query.pageSize >= query.totalCount
  ) {
    return false;
  }
  if (
    event.direction === "after" &&
    query.totalCount === null &&
    sourceState.snapshot.nodes.length < query.pageSize
  ) {
    return false;
  }

  return session.setLevelPage(
    levelId,
    event.loadPath,
    nextPage,
    query.pageSize,
  );
}
