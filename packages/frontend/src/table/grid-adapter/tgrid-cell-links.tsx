/**
 * Attaches schema-declared cell links (`ColumnSchema.links`) to a mapped
 * grid column. The first link that resolves against the row becomes the
 * cell's primary link: a trailing icon-anchor in the cell and an Enter
 * activation. All of a row's links (cell + row level) additionally surface
 * in the grid's right-click context menu — see `renderTGridLinkMenuItems`.
 *
 * Editable cells keep their editing gestures: the grid gives Enter-to-edit
 * precedence over activation, and the anchor is a small adornment beside
 * the value rather than a wrapper around it.
 */

import type { MouseEvent } from "react";
import type {
  ColumnSchema as TableColumnSchema,
  NavLink,
} from "@sapporta/shared/contracts";
import type {
  CellActivation,
  CellRenderProps,
  ColumnSchema as GridColumnSchema,
  LevelRow,
} from "@sapporta/grid";
import { catalogTableLabel } from "../../links/catalog-label";
import {
  resolveLinks,
  type LinkResolutionContext,
  type ResolvedLink,
} from "../../links/resolve-link";
import {
  handleResolvedLinkClick,
  linkRel,
  openResolvedLink,
} from "../../links/open-link";
import { LinkIconGlyph } from "../../links/LinkMenuItems";
import "./tgrid-cell-links.css";

function rowLinkContext(row: LevelRow): LinkResolutionContext | null {
  // Only real data rows carry the source values a bind can reference.
  if (row.kind !== "data") return null;
  return { values: row.columns, tableLabel: catalogTableLabel };
}

export function resolveTGridCellLinks(
  column: TableColumnSchema,
  row: LevelRow,
): ResolvedLink[] {
  const context = rowLinkContext(row);
  if (!context || !column.links?.length) return [];
  return resolveLinks(column.links, context);
}

export function resolveTGridRowLinks(
  rowLinks: readonly NavLink[] | undefined,
  row: LevelRow,
): ResolvedLink[] {
  const context = rowLinkContext(row);
  if (!context || !rowLinks?.length) return [];
  return resolveLinks(rowLinks, context);
}

/** Wraps a mapped grid column so declared cell links render and activate. */
export function withTGridCellLinks(
  gridColumn: GridColumnSchema,
  column: TableColumnSchema,
): GridColumnSchema {
  if (!column.links?.length) return gridColumn;

  const renderCell = gridColumn.renderCell;
  return {
    ...gridColumn,
    renderCell: (props: CellRenderProps) => {
      const content = renderCell(props);
      const link = resolveTGridCellLinks(column, props.row)[0];
      if (!link) return content;
      return (
        <span className="tgrid-cell-link-wrap">
          <span className="tgrid-cell-link-wrap__content">{content}</span>
          <a
            href={link.href}
            target={link.target}
            rel={linkRel(link.target)}
            tabIndex={-1}
            title={link.label}
            aria-label={link.label}
            className="tgrid-cell-link"
            data-grid-part="cell-link"
            onClick={(event: MouseEvent) =>
              handleResolvedLinkClick(event, link)
            }
          >
            <LinkIconGlyph icon={link.icon} className="h-3.5 w-3.5" />
          </a>
        </span>
      );
    },
    // Enter opens the primary link. On editable cells the grid gives
    // Enter-to-edit precedence, so this only fires for read-only cells.
    activation: gridColumn.activation ?? cellLinkActivation(column),
  };
}

function cellLinkActivation(column: TableColumnSchema): CellActivation {
  return {
    startsOn: ["enter"],
    describe: (context) => {
      const link = resolveTGridCellLinks(column, context.row)[0];
      if (link) return { label: link.label, availability: { kind: "enabled" } };
      return {
        label: "Open link",
        availability: {
          kind: "disabled",
          reason: "No link is available for this cell.",
        },
      };
    },
    run: (context) => {
      const link = resolveTGridCellLinks(column, context.row)[0];
      if (link) openResolvedLink(link);
    },
  };
}
