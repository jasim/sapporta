import type { ReactNode } from "react";
import type {
  CellActivation,
  CellEditBehavior,
  CellEditorProps,
  CellRenderProps,
} from "../core/types/schema";
import type { ColumnHeaderMenuProps, ColumnHeaderProps } from "./types";
import type { ColumnPreset } from "./preset";

export type ColumnPresetValueCodec = {
  format: (value: unknown) => string;
  parse?: (value: string, props: CellEditorProps) => unknown;
  compare: (a: unknown, b: unknown) => number;
};

export type ColumnPresetCellView = {
  renderCell: (props: CellRenderProps) => ReactNode;
};

export type ColumnPresetHeaderBehavior<TMeta = unknown> = {
  sortable: boolean;
  renderColumnHeader?: (props: ColumnHeaderProps<TMeta>) => ReactNode;
  renderColumnHeaderMenu?: (
    props: ColumnHeaderMenuProps<TMeta, unknown>,
  ) => ReactNode;
};

export type ColumnPresetRuntime<TMeta = unknown> = {
  preset: ColumnPreset;
  meta?: TMeta;
  valueCodec: ColumnPresetValueCodec;
  cellView: ColumnPresetCellView;
  edit?: CellEditBehavior;
  activation?: CellActivation;
  headerBehavior: ColumnPresetHeaderBehavior<TMeta>;
};

export type ColumnPresetCellRenderRuntime = Pick<
  ColumnPresetRuntime,
  "preset" | "valueCodec"
>;
