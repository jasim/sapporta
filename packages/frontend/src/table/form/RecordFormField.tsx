import { memo, useCallback } from "react";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { LookupCapabilities } from "@sapporta/grid/lookup";
import { FormField } from "@/table/form/FormField";
import {
  useRecordFieldValue,
  useRecordFormSetValue,
} from "@/table/form/RecordFormProvider";

interface RecordFormFieldProps {
  column: ColumnSchema;
  lookup?: LookupCapabilities;
}

function RecordFormFieldComponent({ column, lookup }: RecordFormFieldProps) {
  const value = useRecordFieldValue(column.name);
  const setValue = useRecordFormSetValue();
  const onChange = useCallback(
    (nextValue: unknown) => setValue(column.name, nextValue),
    [column.name, setValue],
  );

  return (
    <FormField
      column={column}
      value={value}
      onChange={onChange}
      lookup={lookup}
    />
  );
}

export const RecordFormField = memo(
  RecordFormFieldComponent,
  areRecordFormFieldPropsEqual,
);

function areRecordFormFieldPropsEqual(
  previous: RecordFormFieldProps,
  next: RecordFormFieldProps,
): boolean {
  return previous.column === next.column && previous.lookup === next.lookup;
}
