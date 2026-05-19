import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { KeyedValues } from "../../../../types";
/** Props for inputs that edit a scalar string (eq, gt, contains, …). */
export interface ScalarInputProps {
  value: string;
  onChange: (next: string) => void;
  column: ColumnSchema;
  autoFocus?: boolean;
  /** Option set for inputs that render a fixed list (unused by scalar text
   *  inputs, but accepted so every input shares a uniform prop surface). */
  options?: string[];
  labels?: KeyedValues;
}

/** Props for inputs that edit a list of strings (in, nin). */
export interface ListInputProps {
  values: string[];
  onChange: (next: string[]) => void;
  column: ColumnSchema;
  autoFocus?: boolean;
  options?: string[];
  labels?: KeyedValues;
}

export type ScalarInputComponent = React.ComponentType<ScalarInputProps>;
export type ListInputComponent = React.ComponentType<ListInputProps>;
