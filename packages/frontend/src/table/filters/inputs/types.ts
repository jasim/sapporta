import type { LookupCapabilities, LookupValue } from "@sapporta/grid/lookup";
import type { ColumnSchema } from "@sapporta/shared/contracts";

export type KeyedValues = Record<string, string>;
export type DraftListValue = string | LookupValue;

/** Props for inputs that edit a scalar string (eq, gt, contains, …). */
export interface ScalarInputProps {
  value: string;
  onChange: (next: string) => void;
  column: ColumnSchema;
  autoFocus?: boolean;
  lookup?: LookupCapabilities;
  /** Option set for inputs that render a fixed list (unused by scalar text
   *  inputs, but accepted so every input shares a uniform prop surface). */
  options?: string[];
  labels?: KeyedValues;
}

export interface TagListInputProps {
  values: string[];
  onChange: (next: string[]) => void;
  column: ColumnSchema;
  autoFocus?: boolean;
}

export interface StaticListInputProps {
  values: string[];
  onChange: (next: string[]) => void;
  column: ColumnSchema;
  options: string[];
  labels?: KeyedValues;
  autoFocus?: boolean;
}

export interface LookupListInputProps {
  values: LookupValue[];
  onChange: (next: LookupValue[]) => void;
  column: ColumnSchema;
  lookup: LookupCapabilities;
  autoFocus?: boolean;
}

export type ScalarInputComponent = React.ComponentType<ScalarInputProps>;
export type TagListInputComponent = React.ComponentType<TagListInputProps>;
export type StaticListInputComponent =
  React.ComponentType<StaticListInputProps>;
export type LookupListInputComponent =
  React.ComponentType<LookupListInputProps>;
