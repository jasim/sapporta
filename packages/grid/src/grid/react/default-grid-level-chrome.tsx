import type { GridLevelChrome } from "./GridLevel";
import { EmptyLevel } from "./EmptyLevel";
import { LevelStatusBand } from "./LevelStatusBand";

export const defaultGridLevelChrome: GridLevelChrome = {
  renderStatus: ({ path }) => <LevelStatusBand path={path} />,
  renderEmpty: ({ path }) => <EmptyLevel path={path} />,
};
