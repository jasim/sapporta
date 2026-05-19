import { useEffect, useRef } from "react";
import type { CellEditorProps } from "../../grid/types/schema";
import { presetRuntime } from "../preset";

export function SelectEditor(props: CellEditorProps) {
  const ref = useRef<HTMLSelectElement | null>(null);
  const columnPreset = presetRuntime(props.column)?.preset;
  const options =
    columnPreset && "select" in columnPreset ? columnPreset.select.options : [];
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <select
      ref={ref}
      value={String(props.value ?? "")}
      onChange={(e) => {
        const option = options.find((o) => String(o.value) === e.target.value);
        props.onCommit(option ? option.value : e.target.value);
      }}
      onBlur={props.onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onCancel();
      }}
      style={{ width: "100%", height: "100%", boxSizing: "border-box" }}
    >
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
