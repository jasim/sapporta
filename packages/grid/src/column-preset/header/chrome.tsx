import type { CSSProperties } from "react";
import type { GridLevelChrome } from "../../grid/react/GridLevel";
import type { PresetChromeOptions } from "../types";
import { templateColumns } from "../width";
import styles from "../sapporta-preset.module.css";
import { ColumnPresetHeader } from "./ColumnPresetHeader";

export function chrome<TMeta = unknown, TFilter = unknown>(
  options: PresetChromeOptions<TMeta, TFilter> = {},
): GridLevelChrome {
  return {
    renderLevelHeader: ({ path, levelName, presentation, schema }) =>
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
