import { memo, useCallback } from "react";
import { FormField } from "./FormField";
import {
  useRecordFieldValue,
  useRecordFieldIssue,
  useRecordFormSetValue,
} from "./RecordFormProvider";
import type { RecordFormFieldModel } from "./record-form-fields";

interface RecordFormFieldProps {
  field: RecordFormFieldModel;
}

function RecordFormFieldComponent({ field }: RecordFormFieldProps) {
  const { column } = field;
  const value = useRecordFieldValue(column.name);
  const issue = useRecordFieldIssue(column.name);
  const setValue = useRecordFormSetValue();
  const onChange = useCallback(
    (nextValue: unknown) => setValue(column.name, nextValue),
    [column.name, setValue],
  );

  return (
    <FormField field={field} value={value} issue={issue} onChange={onChange} />
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
  return previous.field === next.field;
}
