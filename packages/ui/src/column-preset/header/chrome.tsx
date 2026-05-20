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
      const depth = decomposePath(path).edges.length;
      const isNested = depth > 0;
      return {
        "--grid-template-columns": templateColumns(schema),
        "--grid-font-size": "var(--text-sap-body)",
        "--grid-background": "var(--sap-surface)",
        "--grid-row-border-block-end": "1px solid var(--sap-border-soft)",
        "--grid-cell-border-inline-end": "0",
        "--grid-cell-min-height": isNested ? "31px" : "var(--height-sap-row)",
        "--grid-cell-padding": "0 10px",
        "--grid-cell-focus-ring-width": "0",
        "--grid-cell-active-focus-background": "var(--sap-selection)",
        "--grid-cell-active-focus-ring-color": "transparent",
        "--grid-cell-active-selection-background": "var(--sap-selection)",
        "--grid-cell-ghost-focus-background": "var(--sap-selection)",
        "--grid-cell-ghost-focus-ring-color": "transparent",
        "--grid-cell-ghost-selection-background": "var(--sap-selection)",
        "--grid-cell-editing-ring-width": "1.5px",
        "--grid-cell-editing-ring-color": "var(--sap-brand)",
        "--grid-header-background": "var(--sap-surface)",
        "--grid-header-color": "var(--sap-fg-muted)",
        "--grid-header-font-size": "var(--text-sap-label)",
        "--grid-header-font-weight": "760",
        "--grid-header-letter-spacing": "var(--tracking-sap-head)",
        "--grid-header-min-height": "var(--height-sap-header)",
        "--grid-header-cell-gap": "4px",
        "--grid-header-cell-padding": "0 10px",
        "--grid-header-cursor": "pointer",
        "--grid-phantom-row-background": "var(--sap-surface)",
        "--grid-editor-background": "var(--sap-surface)",
        "--grid-level-label-color": "var(--sap-fg-subtle)",
        "--grid-level-label-font-size": "var(--text-sap-label)",
        "--grid-level-label-font-weight": "700",
        "--grid-level-label-letter-spacing": "var(--tracking-sap-head)",
        "--grid-level-label-min-height": "18px",
        "--grid-level-label-text-transform": "uppercase",
        background: isNested ? "var(--sap-nested-bg)" : undefined,
        marginInlineStart:
          depth === 0 ? undefined : depth === 1 ? "58px" : "46px",
        paddingBlockEnd: isNested ? "14px" : undefined,
        paddingBlockStart: isNested ? "10px" : undefined,
        paddingInlineEnd: isNested ? "14px" : undefined,
      } as CSSProperties;
    },
  };
}
