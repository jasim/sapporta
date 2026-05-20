import { useState, type MouseEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ColumnSchema } from "../../grid/types/schema";
import type { GridPath } from "../../grid/types/identity";
import { decomposePath } from "../../grid/types/identity";
import { cycleSort } from "@/grid/sort";
import {
  useGridRuntime,
  useLevelSnapshot,
} from "../../grid/react/GridRuntimeProvider";
import { cn } from "@/ui/utils/cn";
import { meta, preset, presetRuntime } from "../preset";
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
  options,
}: {
  path: GridPath;
  levelName: string;
  schema: ColumnSchema[];
  options: PresetChromeOptions<TMeta, TFilter>;
}) {
  const runtime = useGridRuntime();
  const snapshot = useLevelSnapshot(path);
  const source = runtime.sourceFor(path);
  const levelState: HeaderLevelState<TFilter> = {
    path,
    levelName,
    schema,
    snapshot: snapshot as HeaderLevelState<TFilter>["snapshot"],
    sort: snapshot.sort,
    filter: snapshot.filter as TFilter | undefined,
    canWrite: source.writable,
  };
  const defaultCommands: GridLevelCommands<TFilter> = {
    setSort: (sort) => source.setSort(sort),
    setFilter: (filter) => source.setFilter(filter),
    setPage: (page, pageSize) => source.setPage(page, pageSize),
    refetch: () => source.refetch(),
    insertRow: (node, atIndex) => runtime.insertRow(path, node, atIndex),
    removeRow: (rowKey) => runtime.removeRow(path, rowKey),
    writeCell: (coord, value) => runtime.writeCell(path, coord, value),
    commitPhantom: (rowKey, atIndex) =>
      runtime.commitPhantom(path, rowKey, atIndex),
  };
  const commands: GridLevelCommands<TFilter> = {
    ...defaultCommands,
    ...options.commandOverrides?.(levelState),
  };
  // Child levels get a compact label row above their column headers.
  const levelLabel = nestedLevelLabel(path, levelName);

  return (
    <div className="grid-header" role="rowgroup">
      {levelLabel ? (
        <LevelLabelRow label={levelLabel} title={levelName} />
      ) : null}
      <div className="grid-row grid-row--header" role="row">
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
}: {
  level: HeaderLevelState<TFilter>;
  column: HeaderColumn<TMeta>;
  commands: GridLevelCommands<TFilter>;
  renderColumnHeaderMenu?: PresetChromeOptions<
    TMeta,
    TFilter
  >["renderColumnHeaderMenu"];
}) {
  const [open, setOpen] = useState(false);
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
  const sortable = runtime?.headerBehavior.sortable === true;
  const close = () => setOpen(false);
  const headerName = column.column.name;

  function handleHeaderClick(e: MouseEvent<HTMLDivElement>) {
    if (!sortable) return;
    commands.setSort(
      cycleSort(
        level.sort ?? [],
        column.column.id,
        e.shiftKey ? "extend" : "replace",
      ),
    );
  }

  return (
    <div
      className="grid-cell grid-cell--header"
      role="columnheader"
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
          "grid-cell__content",
          styles.headerContent,
          columnPreset?.layout.align === "right" && styles.headerContentRight,
        )}
      >
        {customHeader ?? defaultHeader(headerName, sort?.direction, sortRank)}
        {menu ? (
          <button
            type="button"
            aria-label={`${column.column.name} menu`}
            aria-expanded={open}
            className="grid-header-menu-button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            <ChevronDown aria-hidden="true" size={11} strokeWidth={1.8} />
          </button>
        ) : null}
      </div>
      {open && menu ? (
        <div
          role="menu"
          className={cn("grid-cell__popover", styles.headerPopover)}
          onClick={(e) => e.stopPropagation()}
        >
          {menu({ level, column, commands, close }) as ReactNode}
        </div>
      ) : null}
    </div>
  );
}

function defaultHeader(
  name: string,
  direction: "asc" | "desc" | undefined,
  rank: number | null,
) {
  return (
    <>
      <span className="grid-header-label">{name}</span>
      {direction ? (
        <span className="grid-header-sort-indicator">
          {direction === "asc" ? (
            <ChevronUp aria-hidden="true" size={10} strokeWidth={1.8} />
          ) : (
            <ChevronDown aria-hidden="true" size={10} strokeWidth={1.8} />
          )}
          {rank}
        </span>
      ) : null}
    </>
  );
}

function LevelLabelRow({ label, title }: { label: string; title: string }) {
  return (
    <div className="grid-row grid-row--level-label" role="row">
      <div
        className={cn("grid-cell grid-cell--level-label", styles.levelLabelCell)}
        role="columnheader"
      >
        <div
          className={cn("grid-cell__content", styles.levelLabelContent)}
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
