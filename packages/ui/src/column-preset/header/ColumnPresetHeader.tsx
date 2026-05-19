import { useState, type ReactNode } from "react";
import type { ColumnSchema } from "../../grid/types/schema";
import type { GridPath } from "../../grid/types/identity";
import {
  useGridRuntime,
  useLevelSnapshot,
} from "../../grid/react/GridRuntimeProvider";
import { meta, preset, presetRuntime } from "../preset";
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

  return (
    <div className="grid-header" role="rowgroup">
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
  const sort = level.sort?.find((s) => s.colId === column.column.id);
  const close = () => setOpen(false);

  return (
    <div
      className="grid-cell grid-cell--header"
      role="columnheader"
      data-col-id={column.column.id}
    >
      <div
        className="grid-cell__content"
        style={{
          justifyContent:
            columnPreset?.layout.align === "right" ? "flex-end" : "flex-start",
          gap: "var(--grid-header-cell-gap, 0)",
        }}
      >
        <span
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {customHeader ?? defaultHeader(column.column.name, sort?.direction)}
        </span>
        {menu ? (
          <button
            type="button"
            aria-label={`${column.column.name} menu`}
            onClick={() => setOpen((v) => !v)}
            style={{
              border: 0,
              background: "transparent",
              cursor: "pointer",
              padding: "var(--grid-header-menu-button-padding, 0)",
            }}
          >
            ...
          </button>
        ) : null}
      </div>
      {open && menu ? (
        <div
          role="menu"
          className="grid-cell__popover"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            zIndex: 20,
            minWidth: 160,
            background: "var(--background, white)",
            border: "1px solid var(--border, #ddd)",
            boxShadow: "0 8px 24px rgb(0 0 0 / 0.12)",
          }}
        >
          {menu({ level, column, commands, close }) as ReactNode}
        </div>
      ) : null}
    </div>
  );
}

function defaultHeader(name: string, direction: "asc" | "desc" | undefined) {
  if (!direction) return name;
  return `${name} ${direction}`;
}
