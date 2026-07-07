import type { CSSProperties } from "react";
import {
  defaultGridLevelChrome,
  type GridLevelChrome,
} from "../../grid/react";
import type { PresetChromeOptions } from "../types";
import { templateColumns } from "../width";
import styles from "../sapporta-preset.module.css";
import { PresetEmptyLevel, PresetLevelStatusBand } from "../LevelStateChrome";
import { ColumnPresetHeader } from "./ColumnPresetHeader";

export function chrome<TMeta = unknown, TFilter = unknown>(
  options: PresetChromeOptions<TMeta, TFilter> = {},
): GridLevelChrome {
  return {
    ...defaultGridLevelChrome,
    renderStatus: ({ path }) => <PresetLevelStatusBand path={path} />,
    renderEmpty: ({ path }) => <PresetEmptyLevel path={path} />,
    renderHeader: ({ path, levelName, presentation, schema }) =>
      presentation === "tabular" ? (
        <ColumnPresetHeader
          path={path}
          levelName={levelName}
          schema={schema}
          options={options}
        />
      ) : null,
    levelContainerClassName: () => `${styles.presetGrid} sapporta-table-grid`,
    levelContainerStyle: ({ schema }) => {
      return {
        "--grid-template-columns": templateColumns(schema),
      } as CSSProperties;
    },
  };
}
