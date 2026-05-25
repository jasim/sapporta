import { useState, useRef } from "react";
import { X } from "lucide-react";
import { Input } from "@sapporta/ui";
import type { ListInputProps } from "./types";

/** Free-form tag entry for `in` / `nin` on text or number columns.
 *  Enter or comma commits the current input as a tag. Backspace on an
 *  empty field removes the last tag. */
export function TagInput({ values, onChange, autoFocus }: ListInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (values.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...values, trimmed]);
    setDraft("");
  }

  function removeTag(i: number) {
    onChange(values.filter((_, idx) => idx !== i));
  }

  return (
    <div
      className="flex flex-wrap items-center gap-[4px] min-h-sap-ctl px-[6px] py-[3px] rounded-[5px] border border-sap-border bg-sap-surface focus-within:border-sap-brand"
      onClick={() => inputRef.current?.focus()}
    >
      {values.map((t, i) => (
        <span
          key={`${t}-${i}`}
          className="inline-flex items-center gap-[4px] h-[18px] px-[6px] rounded-[3px] bg-sap-chip text-sap-fg text-sap-emph"
        >
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            onClick={(e) => {
              e.stopPropagation();
              removeTag(i);
            }}
            className="text-sap-muted hover:text-sap-fg"
          >
            <X className="h-[10px] w-[10px]" />
          </button>
        </span>
      ))}
      <Input
        ref={inputRef}
        autoFocus={autoFocus}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
            e.preventDefault();
            removeTag(values.length - 1);
          }
        }}
        onBlur={commit}
        placeholder={values.length === 0 ? "Add values…" : ""}
        className="flex-1 min-w-[80px] h-auto border-0 shadow-none focus-visible:ring-0 px-0"
      />
    </div>
  );
}
