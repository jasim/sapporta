import { useEffect, useRef, useState } from "react";
import type { CellEditorProps } from "../../grid/types/schema";
import { focusEditorInput } from "./editor-focus";
import { parseForCommit } from "./parse-for-commit";

export function DateEditor(props: CellEditorProps) {
  const [value, setValue] = useState(() => initialDateEditorValue(props));
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    focusEditorInput(ref.current, props.trigger);
  }, [props.trigger]);

  return (
    <input
      ref={ref}
      type="date"
      className="mono text-sap-data text-sap-muted"
      data-grid-part="editor-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => props.onCommit(parseForCommit(props, value))}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onCancel();
        if (e.key === "Enter")
          props.onCommit(parseForCommit(props, value), "down");
        if (e.key === "Tab") {
          e.preventDefault();
          props.onCommit(
            parseForCommit(props, value),
            e.shiftKey ? "prev" : "next",
          );
        }
      }}
    />
  );
}

export function initialDateEditorValue(props: CellEditorProps): string {
  if (props.trigger === "type") return props.typedSeed;
  return props.value == null ? "" : String(props.value);
}
