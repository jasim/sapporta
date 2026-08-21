import type { StoreApi } from "zustand/vanilla";
import type {
  TGridLevelId,
  TGridRowsByLevel,
  TGridTableRow,
} from "../tgrid/tgrid-types";
import type { TGridLevelQueryState } from "../tgrid/tgrid-level-query-state";
import type { TGridSession } from "../tgrid/tgrid-session";

export function requireHostQueryStore<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>(
  session: TGridSession<RowsByLevel, AppServices>,
  level: TGridLevelId<RowsByLevel>,
  caller: string,
): StoreApi<TGridLevelQueryState<TGridTableRow>> {
  const store = session.levels[level].queryStore as
    | StoreApi<TGridLevelQueryState<TGridTableRow>>
    | undefined;
  if (!store) {
    throw new Error(
      `${caller}: level '${String(level)}' does not have host-owned query state`,
    );
  }
  return store;
}
