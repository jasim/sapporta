import { Input } from "@sapporta/ui/input";
import type { ScalarInputComponent, ScalarInputProps } from "./types";

/** Build a scalar text/number/date input. One implementation, three HTML
 *  input types — the only thing that varies between text, number, and date
 *  is `type` and the placeholder. */
export function scalarInput(
  type: "text" | "number" | "date",
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
export const DateInput = scalarInput("date");
