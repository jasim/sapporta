import {
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp, EllipsisVertical } from "lucide-react";
import type { ColumnSchema, RowHeaderColumn } from "../../core/types/schema";
import type { GridPath } from "../../core/types/identity";
import { decomposePath } from "../../core/types/identity";
import { cycleSort } from "../../core/sort";
import {
  useGridRuntime,
  useLevelSnapshot,
} from "../../core/react/GridRuntimeProvider";
import { cn, Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui";
import { meta, preset, presetRuntime } from "../preset";
import {
  clampColumnPixelWidth,
  columnSizingTemplateColumns,
  loadColumnSizingOverrides,
  resolveColumnSizing,
  saveColumnSizingOverrides,
  type ColumnSizingOptions,
  type ColumnSizingOverrides,
} from "../column-sizing";
import styles from "../sapporta-preset.module.css";
import type {
  GridLevelCommands,
  HeaderColumn,
  HeaderLevelState,
  PresetChromeOptions,
} from "../types";

export function ColumnPresetHeader<TMeta = unknown, TFilter = unknown>({
  path,
  levelName,
  schema,
  rowHeaderColumn,
  options,
}: {
  path: GridPath;
  levelName: string;
  schema: readonly ColumnSchema[];
  rowHeaderColumn: RowHeaderColumn;
  options: PresetChromeOptions<TMeta, TFilter>;
}) {
  const runtime = useGridRuntime();
  const level = runtime.level(path);
  const snapshot = useLevelSnapshot(path);
  const source = level.data;
  const levelState: HeaderLevelState<TFilter> = {
    path,
    levelName,
    schema,
    snapshot,
    sort: source.query?.sort?.current(),
    filter: source.query?.filter?.current() as TFilter | undefined,
    canWrite: source.canWrite,
  };
  const defaultCommands: GridLevelCommands<TFilter> = {
    setSort: source.query?.sort?.set,
    setFilter: source.query?.filter?.set as
      | GridLevelCommands<TFilter>["setFilter"]
      | undefined,
    refetch: source.query?.refetch,
    createRow: level.createRow,
    removeRow: level.removeRow,
    writeCell: level.writeCell,
    commitPhantomRow: level.drafts.commit,
  };
  const commands: GridLevelCommands<TFilter> = {
    ...defaultCommands,
    ...options.commandOverrides?.(levelState),
  };
  // Child levels get a compact label row above their column headers.
  const levelLabel = nestedLevelLabel(path, levelName);

  return (
    <div data-grid-part="header" role="rowgroup">
      {levelLabel ? (
        <LevelLabelRow label={levelLabel} title={levelName} />
      ) : null}
      <div data-grid-part="header-row" role="row">
        {rowHeaderColumn === "empty-selectable-cell" ? (
          <div role="columnheader" data-grid-part="row-header-header-cell" />
        ) : null}
        {schema.map((column, columnIndex) => (
          <HeaderCell
            key={column.id}
            level={levelState}
            column={{
              column,
              columnIndex,
              preset: preset(column),
              meta: meta<TMeta>(column),
            }}
            commands={commands}
            renderColumnHeaderMenu={options.renderColumnHeaderMenu}
            columnSizing={options.columnSizing}
          />
        ))}
      </div>
    </div>
  );
}

function HeaderCell<TMeta = unknown, TFilter = unknown>({
  level,
  column,
  commands,
  renderColumnHeaderMenu,
  columnSizing,
}: {
  level: HeaderLevelState<TFilter>;
  column: HeaderColumn<TMeta>;
  commands: GridLevelCommands<TFilter>;
  renderColumnHeaderMenu?: PresetChromeOptions<
    TMeta,
    TFilter
  >["renderColumnHeaderMenu"];
  columnSizing?: ColumnSizingOptions;
}) {
  const [open, setOpen] = useState(false);
  const resizeDrag = useRef<ResizeDragState | null>(null);
  const columnPreset = column.preset;
  const runtime = presetRuntime<TMeta>(column.column);
  const customHeader = runtime?.headerBehavior.renderColumnHeader?.({
    level: level as HeaderLevelState,
    column,
    commands: commands as GridLevelCommands,
  });
  const menu =
    renderColumnHeaderMenu ??
    (runtime?.headerBehavior
      .renderColumnHeaderMenu as typeof renderColumnHeaderMenu);
  const sortIndex = level.sort?.findIndex((s) => s.colId === column.column.id);
  const sort =
    sortIndex != null && sortIndex >= 0 && level.sort
      ? level.sort[sortIndex]
      : undefined;
  const sortRank =
    sortIndex != null && sortIndex >= 0 && (level.sort?.length ?? 0) > 1
      ? sortIndex + 1
      : null;
  const sortable =
    runtime?.headerBehavior.sortable === true && commands.setSort !== undefined;
  const close = () => setOpen(false);
  const headerName = column.column.name;
  const sizing = resolveColumnSizing(columnSizing, {
    path: level.path,
    levelName: level.levelName,
    schema: level.schema,
  });

  function handleHeaderClick(e: MouseEvent<HTMLDivElement>) {
    if (!sortable) return;
    void commands.setSort?.(
      cycleSort(
        level.sort ?? [],
        column.column.id,
        e.shiftKey ? "extend" : "replace",
      ),
    );
  }

  function handleResizePointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (!sizing.enabled) return;
    if (e.button !== 0) return;

    const handle = e.currentTarget;
    const headerCell = handle.closest('[data-grid-part="header-cell"]');
    const root = handle.closest("[data-grid-path]");
    if (!(headerCell instanceof HTMLElement)) return;
    if (!(root instanceof HTMLElement)) return;

    e.preventDefault();
    e.stopPropagation();

    const startWidth = headerCell.getBoundingClientRect().width;
    resizeDrag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth,
      root,
      handle,
      overrides: loadColumnSizingOverrides(sizing, level.schema),
    };
    handle.dataset.resizing = "true";
    handle.setPointerCapture?.(e.pointerId);
  }

  function handleResizePointerMove(e: PointerEvent<HTMLButtonElement>) {
    const drag = resizeDrag.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    e.preventDefault();
    e.stopPropagation();

    const nextWidth = clampColumnPixelWidth(
      column.column,
      drag.startWidth + e.clientX - drag.startX,
      sizing.minPx,
    );
    drag.overrides = {
      ...drag.overrides,
      [column.column.id]: nextWidth,
    };
    applyColumnSizingToElement(
      drag.root,
      level.schema,
      drag.overrides,
      sizing.minPx,
    );
  }

  function finishResize(e: PointerEvent<HTMLButtonElement>) {
    const drag = resizeDrag.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    e.preventDefault();
    e.stopPropagation();

    saveColumnSizingOverrides(sizing, level.schema, drag.overrides);
    drag.handle.releasePointerCapture?.(e.pointerId);
    delete drag.handle.dataset.resizing;
    resizeDrag.current = null;
  }

  return (
    <div
      role="columnheader"
      data-grid-part="header-cell"
      aria-sort={
        sort?.direction === "asc"
          ? "ascending"
          : sort?.direction === "desc"
            ? "descending"
            : undefined
      }
      data-col-id={column.column.id}
      data-sortable={sortable}
      title={headerName}
      onClick={handleHeaderClick}
    >
      <div
        className={cn(
          styles.headerContent,
          columnPreset?.layout.align === "right" && styles.headerContentRight,
        )}
        data-grid-part="cell-content"
      >
        {customHeader ?? defaultHeader(headerName, sort?.direction, sortRank)}
        {menu ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={`${column.column.name} menu`}
                  aria-expanded={open}
                  data-grid-part="header-menu-button"
                  onClick={(e) => e.stopPropagation()}
                />
              }
            >
              <EllipsisVertical
                aria-hidden="true"
                size={14}
                strokeWidth={2}
              />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={4}
              role="menu"
              className={cn(styles.cellPopover, styles.headerPopover)}
              data-grid-part="cell-popover"
              style={{ zIndex: "var(--sap-z-grid-header-popover)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {menu({ level, column, commands, close }) as ReactNode}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
      {sizing.enabled ? (
        <button
          type="button"
          aria-label={`Resize ${column.column.name} column`}
          className={styles.columnResizeHandle}
          data-grid-part="column-resize-handle"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
        />
      ) : null}
    </div>
  );
}

type ResizeDragState = {
  pointerId: number;
  startX: number;
  startWidth: number;
  root: HTMLElement;
  handle: HTMLButtonElement;
  overrides: ColumnSizingOverrides;
};

function applyColumnSizingToElement(
  root: HTMLElement,
  schema: readonly ColumnSchema[],
  overrides: ColumnSizingOverrides,
  minPx: number,
) {
  root.style.setProperty(
    "--grid-template-columns",
    columnSizingTemplateColumns(schema, overrides, minPx),
  );
}

function defaultHeader(
  name: string,
  direction: "asc" | "desc" | undefined,
  rank: number | null,
) {
  return (
    <>
      <span data-grid-part="header-label">{name}</span>
      {direction ? (
        <span data-grid-part="header-sort-indicator">
          {direction === "asc" ? (
            <ChevronUp aria-hidden="true" size={14} strokeWidth={2.25} />
          ) : (
            <ChevronDown aria-hidden="true" size={14} strokeWidth={2.25} />
          )}
          {rank}
        </span>
      ) : null}
    </>
  );
}

function LevelLabelRow({ label, title }: { label: string; title: string }) {
  return (
    <div data-grid-part="level-label-row" role="row">
      <div
        className={styles.levelLabelCell}
        role="columnheader"
        data-grid-part="level-label-cell"
      >
        <div
          className={styles.levelLabelContent}
          data-grid-part="cell-content"
          title={title}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

function nestedLevelLabel(path: GridPath, levelName: string): string | null {
  if (decomposePath(path).edges.length === 0) return null;
  return compactLevelName(levelName);
}

function compactLevelName(levelName: string): string {
  const dot = levelName.lastIndexOf(".");
  return dot >= 0 ? levelName.slice(dot + 1) : levelName;
}
