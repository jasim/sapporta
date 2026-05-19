import type { CSSProperties } from "react";
import type { GridLevelChrome } from "../../grid/react/GridLevel";
import type { PresetChromeOptions } from "../types";
import { templateColumns } from "../width";
import { ColumnPresetHeader } from "./ColumnPresetHeader";

export function chrome<TMeta = unknown, TFilter = unknown>(
  options: PresetChromeOptions<TMeta, TFilter> = {},
): GridLevelChrome {
  return {
    renderLevelHeader: ({ path, levelName, schema }) => (
      <ColumnPresetHeader
        path={path}
        levelName={levelName}
        schema={schema}
        options={options}
      />
    ),
    levelContainerStyle: ({ schema }) =>
      ({
        "--grid-template-columns": templateColumns(schema),
        "--grid-font-size": "13px",
        "--grid-background": "var(--sap-surface)",
        "--grid-row-border-block-end": "1px solid var(--sap-border)",
        "--grid-cell-border-inline-end": "1px solid var(--sap-border)",
        "--grid-cell-min-height": "26px",
        "--grid-cell-padding": "4px 8px",
        "--grid-cell-focus-background": "var(--sap-row-hover)",
        "--grid-cell-focus-ring-width": "2px",
        "--grid-cell-focus-ring-color": "var(--sap-link, #2563eb)",
        "--grid-cell-focus-ring-inset": "-1px",
        "--grid-cell-selection-background": "rgba(37, 99, 235, 0.08)",
        "--grid-header-background": "var(--sap-bg)",
        "--grid-header-color": "var(--sap-fg)",
        "--grid-header-font-weight": "600",
        "--grid-header-cell-gap": "6px",
        "--grid-header-menu-button-padding": "0 2px",
        "--grid-phantom-row-background": "var(--sap-nested)",
        "--grid-editor-background": "var(--sap-surface)",
      }) as CSSProperties,
  };
}
