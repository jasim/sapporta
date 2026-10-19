import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Combobox, comboboxClassNames } from "@sapporta/ui";
import { cn } from "@sapporta/ui/cn";
import type { CellEditorProps } from "../../core/types/schema";
import { presetRuntime } from "../preset";

export function SelectEditor(props: CellEditorProps) {
  const columnPreset = presetRuntime(props.column)?.preset;
  const options =
    columnPreset && "select" in columnPreset ? columnPreset.select.options : [];
  const selectedOption =
    options.find((option) => Object.is(option.value, props.value)) ?? null;
  const [inputValue, setInputValue] = useState(() =>
    props.editStart.trigger === "type" ? props.editStart.typedSeed : "",
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full"
      onBlurCapture={() => {
        window.setTimeout(() => {
          if (!rootRef.current?.contains(document.activeElement)) {
            props.cancel();
          }
        }, 0);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          props.cancel();
        }
      }}
    >
      <Combobox.Root
        items={options}
        value={selectedOption}
        onValueChange={(option) => {
          if (option !== null) props.commit(option.value);
        }}
        inputValue={inputValue}
        onInputValueChange={setInputValue}
        itemToStringLabel={(option) => option.label}
        isItemEqualToValue={(option, selected) =>
          Object.is(option.value, selected.value)
        }
        autoHighlight
        open
        onOpenChange={(open, details) => {
          // The positioned popup handles Escape itself to close the list,
          // so the wrapper's keydown handler never sees it. Closing the list
          // ends the edit.
          if (!open && details.reason === "escape-key") props.cancel();
        }}
      >
        <Combobox.InputGroup
          className={cn(
            comboboxClassNames.inputGroup,
            "h-full rounded-none border-0 bg-transparent shadow-none",
          )}
        >
          <Combobox.Input
            ref={inputRef}
            placeholder="Search…"
            className={cn(
              comboboxClassNames.input,
              "h-full py-0 text-sap-body",
            )}
            data-grid-part="editor-input"
          />
        </Combobox.InputGroup>
        <Combobox.Portal>
          <Combobox.Positioner
            align="start"
            sideOffset={4}
            className={comboboxClassNames.positioner}
          >
            <Combobox.Popup
              className={cn(
                comboboxClassNames.popup,
                "w-auto min-w-(--anchor-width)",
              )}
            >
              <Combobox.Empty className={comboboxClassNames.empty}>
                No results.
              </Combobox.Empty>
              <Combobox.List
                className={cn(comboboxClassNames.list, "max-h-64")}
              >
                {(option, index) => (
                  <Combobox.Item
                    key={index}
                    value={option}
                    className={comboboxClassNames.item}
                  >
                    {option.label}
                    <Combobox.ItemIndicator
                      className={comboboxClassNames.itemIndicator}
                    >
                      <Check aria-hidden />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}
