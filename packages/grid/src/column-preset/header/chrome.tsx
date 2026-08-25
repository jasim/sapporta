import type { CSSProperties } from "react";
import { defaultGridLevelChrome, type GridLevelChrome } from "../../core/react";
import type { PresetChromeOptions } from "../types";
import { templateColumns } from "../width";
import {
  loadColumnSizingOverrides,
  resolveColumnSizing,
} from "../column-sizing";
import styles from "../sapporta-preset.module.css";
import { PresetEmptyLevel, PresetLevelStatusBand } from "../LevelStateChrome";
import { ColumnPresetHeader } from "./ColumnPresetHeader";
import { ColumnPresetSelectionSummary } from "../SelectionSummary";

export function chrome<TMeta = unknown, TFilter = unknown>(
  options: PresetChromeOptions<TMeta, TFilter> = {},
): GridLevelChrome {
  return {
    ...defaultGridLevelChrome,
    renderStatus: ({ path }) => <PresetLevelStatusBand path={path} />,
    renderEmpty: ({ path }) => <PresetEmptyLevel path={path} />,
    renderSelectionSummary: (context) => (
      <ColumnPresetSelectionSummary {...context} />
    ),
    renderHeader: ({
      path,
      levelName,
      presentation,
      schema,
      rowHeaderColumn,
    }) =>
      presentation === "tabular" ? (
        <ColumnPresetHeader
          path={path}
          levelName={levelName}
          schema={schema}
          rowHeaderColumn={rowHeaderColumn}
          options={options}
        />
      ) : null,
    levelContainerClassName: () => `${styles.presetGrid} sapporta-table-grid`,
    levelContainerStyle: ({ path, levelName, schema }) => {
      const sizing = resolveColumnSizing(options.columnSizing, {
        path,
        levelName,
        schema,
      });
      const overrides = loadColumnSizingOverrides(sizing, schema);
      return {
        "--grid-template-columns": templateColumns(schema, overrides),
      } as CSSProperties;
    },
  };
}
