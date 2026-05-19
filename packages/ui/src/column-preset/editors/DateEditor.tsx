import { useEffect, useRef, useState } from "react";
import type { CellEditorProps } from "../../grid/types/schema";
import { parseForCommit } from "./parse-for-commit";

export function DateEditor(props: CellEditorProps) {
  const [value, setValue] = useState(() => initialDateEditorValue(props));
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      type="date"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => props.onCommit(parseForCommit(props, value))}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onCancel();
        if (e.key === "Enter") props.onCommit(parseForCommit(props, value), "down");
        if (e.key === "Tab") {
          e.preventDefault();
          props.onCommit(parseForCommit(props, value), e.shiftKey ? "prev" : "next");
        }
      }}
      style={{ width: "100%", height: "100%", boxSizing: "border-box" }}
    />
  );
}

export function initialDateEditorValue(props: CellEditorProps): string {
  if (props.trigger === "type") return props.typedSeed;
  return props.value == null ? "" : String(props.value);
}
