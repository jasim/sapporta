import { Input } from "@sapporta/ui/input";
import type { ScalarInputComponent, ScalarInputProps } from "./types";
import { dateInputConditionValue, dateInputValue } from "../date-filter-value";

/** Build a scalar text/number input. One implementation, two HTML input
 *  types — the only thing that varies between text and number is `type` and
 *  the placeholder. */
export function scalarInput(
  type: "text" | "number",
  placeholder = "",
): ScalarInputComponent {
  return function ScalarInput({
    value,
    onChange,
    autoFocus,
  }: ScalarInputProps) {
    return (
      <Input
        type={type}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-sap-ctl"
        placeholder={placeholder}
      />
    );
  };
}

export const TextInput = scalarInput("text", "Value");
export const NumberInput = scalarInput("number", "0");

/** A calendar-date control, for `date` and `timestamp` columns alike. The
 *  control speaks `YYYY-MM-DD` in both directions; a timestamp column stores
 *  instants, so its values are translated through the zone this page reads on
 *  — the same zone the cells beside it are written in, so the day a reader
 *  picks is the day they can see. */
export function DateInput({
  value,
  onChange,
  column,
  op,
  autoFocus,
}: ScalarInputProps) {
  return (
    <Input
      type="date"
      autoFocus={autoFocus}
      value={dateInputValue(column, value)}
      onChange={(e) =>
        onChange(dateInputConditionValue(column, op, e.target.value))
      }
      className="h-sap-ctl"
    />
  );
}
