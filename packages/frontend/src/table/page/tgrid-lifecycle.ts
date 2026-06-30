import { useEffect } from "react";
import type { TGridRowsByLevel } from "../grid-adapter/tgrid-types";
import { startTGridLookupLoading } from "../lookup/tgrid-lookup-loading";
import type { TGridSession } from "../state/tgrid-session";
import {
  registerTGridSession,
  unregisterTGridSession,
} from "../state/tgrid-session-registry";

// Optional page-level side effects for a live grid session.
// `registerAs` lets app actions such as "save a new record, then reload the
// table" find this mounted session. `loadLookups` starts FK/display lookup
// loading for cells that need human-readable labels.
export type UseTGridLifecycleArgs<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
> = {
  session: TGridSession<RowsByLevel, AppServices> | null;
  registerAs?: string;
  loadLookups?: boolean;
};

// Start the table services that should live exactly as long as the React page.
// If your custom view only needs the grid data and not lookup labels or a
// reload target, leave the corresponding option out.
export function useTGridLifecycle<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>({
  session,
  registerAs,
  loadLookups = true,
}: UseTGridLifecycleArgs<RowsByLevel, AppServices>): void {
  useEffect(() => {
    if (!session) return;

    if (registerAs) registerTGridSession(registerAs, session);
    const stopLookupLoading = loadLookups
      ? startTGridLookupLoading(session)
      : undefined;

    return () => {
      stopLookupLoading?.();
      if (registerAs) unregisterTGridSession(registerAs);
    };
  }, [loadLookups, registerAs, session]);
}
