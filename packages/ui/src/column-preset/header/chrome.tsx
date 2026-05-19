import type { CSSProperties } from "react";
import type { GridLevelChrome } from "../../grid/react/GridLevel";
import { decomposePath } from "../../grid/types/identity";
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
    levelContainerStyle: ({ path, schema }) => {
      const isNested = decomposePath(path).edges.length > 0;
      return {
        "--grid-template-columns": templateColumns(schema),
        "--grid-font-size": "var(--text-sap-body)",
        "--grid-background": "var(--sap-surface)",
        "--grid-row-border-block-end": "1px solid var(--sap-border)",
        "--grid-cell-border-inline-end": "1px solid var(--sap-border)",
        "--grid-cell-min-height": "var(--height-sap-row)",
        "--grid-cell-padding": "0 10px",
        "--grid-cell-focus-ring-width": "1.5px",
        "--grid-cell-active-focus-background": "var(--sap-selection)",
        "--grid-cell-active-focus-ring-color": "var(--sap-brand)",
        "--grid-cell-active-selection-background": "var(--sap-selection)",
        "--grid-cell-ghost-focus-background": "var(--sap-nested-bg)",
        "--grid-cell-ghost-focus-ring-color": "var(--sap-focus-ring)",
        "--grid-cell-ghost-selection-background": "var(--sap-nested-bg)",
        "--grid-cell-editing-ring-color": "var(--sap-brand)",
        "--grid-header-background": "var(--sap-sidebar)",
        "--grid-header-color": "var(--sap-fg-subtle)",
        "--grid-header-font-size": "var(--text-sap-label)",
        "--grid-header-font-weight": "500",
        "--grid-header-letter-spacing": "var(--tracking-sap-head)",
        "--grid-header-min-height": "var(--height-sap-header)",
        "--grid-header-cell-gap": "4px",
        "--grid-header-cell-padding": "0 10px",
        "--grid-header-cursor": "pointer",
        "--grid-phantom-row-background": "var(--sap-nested-bg)",
        "--grid-editor-background": "var(--sap-surface)",
        // Child grids are grid items; margin indents without changing tracks.
        marginInlineStart: isNested ? "32px" : undefined,
      } as CSSProperties;
    },
  };
}
