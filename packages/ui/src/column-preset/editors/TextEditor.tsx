import { useEffect, useRef, useState } from "react";
import type { CellEditorProps } from "../../grid/types/schema";
import { presetRuntime } from "../preset";
import { parseForCommit } from "./parse-for-commit";

export function TextEditor(props: CellEditorProps) {
  const [value, setValue] = useState(() => initialTextEditorValue(props));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const columnPreset = presetRuntime(props.column)?.preset;
  const multiLine =
    columnPreset != null &&
    "text" in columnPreset &&
    columnPreset.text.display != null;

  useEffect(() => {
    const node = multiLine ? textareaRef.current : inputRef.current;
    if (!node) return;
    node.focus();
    node.select();
  }, [multiLine]);

  if (multiLine) {
    return (
      <textarea
        ref={textareaRef}
        className="grid-editor-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => props.onCommit(parseForCommit(props, value))}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            props.onCancel();
            return;
          }
          if (e.key === "Tab") {
            e.preventDefault();
            props.onCommit(
              parseForCommit(props, value),
              e.shiftKey ? "prev" : "next",
            );
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            props.onCommit(parseForCommit(props, value));
          }
        }}
        style={{
          height: "100%",
        }}
      />
    );
  }

  return (
    <input
      ref={inputRef}
      className="grid-editor-input"
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

export function initialTextEditorValue(props: CellEditorProps): string {
  if (props.trigger === "type") return props.typedSeed;
  return props.value == null ? "" : String(props.value);
}
