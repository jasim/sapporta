import { useEffect, useRef, useState } from "react";
import type { CellEditorProps, CellEditorStart } from "../../core/types/schema";
import { presetRuntime } from "../preset";
import styles from "../sapporta-preset.module.css";
import { focusEditorInput } from "./editor-focus";
import { parseForCommit } from "./parse-for-commit";

export function TextEditor(props: CellEditorProps) {
  const [value, setValue] = useState(() =>
    initialTextEditorValue(props.value, props.editStart),
  );
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
    focusEditorInput(node, props.editStart);
  }, [multiLine, props.editStart]);

  if (multiLine) {
    return (
      <textarea
        ref={textareaRef}
        className={styles.textEditorMultiline}
        data-grid-part="editor-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => props.commit(parseForCommit(props, value))}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            props.cancel();
            return;
          }
          if (e.key === "Tab") {
            e.preventDefault();
            props.commit(
              parseForCommit(props, value),
              e.shiftKey ? "prev" : "next",
            );
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            props.commit(parseForCommit(props, value));
          }
        }}
      />
    );
  }

  return (
    <input
      ref={inputRef}
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

export function initialTextEditorValue(
  value: unknown,
  editStart: CellEditorStart,
): string {
  if (editStart.trigger === "type") return editStart.typedSeed;
  return value == null ? "" : String(value);
}
