import { useEffect, useRef, useState } from "react";
import type { CellEditorProps, CellEditorStart } from "../../core/types/schema";
import { focusEditorInput } from "./editor-focus";
import { parseForCommit } from "./parse-for-commit";

export function DateEditor(props: CellEditorProps) {
  const [value, setValue] = useState(() =>
    initialDateEditorValue(props.value, props.editStart),
  );
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    focusEditorInput(ref.current, props.editStart);
  }, [props.editStart]);

  return (
    <input
      ref={ref}
      type="date"
      className="mono text-sap-data text-sap-muted"
      data-grid-part="editor-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => props.commit(parseForCommit(props, value))}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.cancel();
        if (e.key === "Enter")
          props.commit(parseForCommit(props, value), "down");
        if (e.key === "Tab") {
          e.preventDefault();
          props.commit(
            parseForCommit(props, value),
            e.shiftKey ? "prev" : "next",
          );
        }
      }}
    />
  );
}

export function initialDateEditorValue(
  value: unknown,
  editStart: CellEditorStart,
): string {
  if (editStart.trigger === "type") return editStart.typedSeed;
  return value == null ? "" : String(value);
}
