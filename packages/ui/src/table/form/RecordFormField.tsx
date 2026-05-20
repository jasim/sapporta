import { memo, useCallback } from "react";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { KeyedValues } from "@/lookup/types";
import { FormField } from "@/table/form/FormField";
import {
  useRecordFieldValue,
  useRecordFormSetValue,
} from "@/table/form/RecordFormProvider";

interface RecordFormFieldProps {
  column: ColumnSchema;
  fkOptions?: KeyedValues;
}

function RecordFormFieldComponent({ column, fkOptions }: RecordFormFieldProps) {
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
      fkOptions={fkOptions}
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
  return (
    previous.column === next.column && previous.fkOptions === next.fkOptions
  );
}
