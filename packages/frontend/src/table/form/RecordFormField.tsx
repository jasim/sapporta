import { memo, useCallback } from "react";
import { FormField } from "./FormField";
import {
  useRecordFieldValue,
  useRecordFormSetValue,
} from "./RecordFormProvider";
import type { RecordFormFieldModel } from "./record-form-fields";

interface RecordFormFieldProps {
  field: RecordFormFieldModel;
}

function RecordFormFieldComponent({ field }: RecordFormFieldProps) {
  const { column } = field;
  const value = useRecordFieldValue(column.name);
  const setValue = useRecordFormSetValue();
  const onChange = useCallback(
    (nextValue: unknown) => setValue(column.name, nextValue),
    [column.name, setValue],
  );

  return <FormField field={field} value={value} onChange={onChange} />;
}

export const RecordFormField = memo(
  RecordFormFieldComponent,
  areRecordFormFieldPropsEqual,
);

function areRecordFormFieldPropsEqual(
  previous: RecordFormFieldProps,
  next: RecordFormFieldProps,
): boolean {
  return previous.field === next.field;
}
