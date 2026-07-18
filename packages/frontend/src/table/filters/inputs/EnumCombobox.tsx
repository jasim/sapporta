import { Check, X } from "lucide-react";
import { Combobox, comboboxClassNames } from "@sapporta/ui/combobox";
import { cn } from "@sapporta/ui/cn";
import type { StaticListInputProps } from "./types";

/** Searchable multiple-value picker for enum `in` and `nin` conditions. */
export function EnumCombobox({
  values,
  onChange,
  options,
  labels,
  autoFocus,
}: StaticListInputProps) {
  return (
    <Combobox.Root<string, true>
      items={options}
      multiple
      value={values}
      onValueChange={(nextValues) => onChange(nextValues)}
      itemToStringLabel={(value) => labels?.[value] ?? value}
      filter={(option, query) => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        if (normalizedQuery === "") return true;
        const label = labels?.[option] ?? option;
        return (
          option.toLocaleLowerCase().includes(normalizedQuery) ||
          label.toLocaleLowerCase().includes(normalizedQuery)
        );
      }}
      inline
      open
    >
      <Combobox.Chips className={comboboxClassNames.chips}>
        {values.map((value) => (
          <Combobox.Chip key={value} className={comboboxClassNames.chip}>
            <span className="max-w-40 truncate">
              {labels?.[value] ?? value}
            </span>
            <Combobox.ChipRemove
              aria-label={`Remove ${labels?.[value] ?? value}`}
              className={comboboxClassNames.chipRemove}
            >
              <X aria-hidden />
            </Combobox.ChipRemove>
          </Combobox.Chip>
        ))}
        <Combobox.Input
          autoFocus={autoFocus}
          placeholder="Search…"
          className={cn(
            comboboxClassNames.input,
            "h-7 min-w-24 flex-[1_0_6rem] px-1 py-0",
          )}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.stopPropagation();
          }}
        />
      </Combobox.Chips>
      <div className="max-h-[220px] overflow-y-auto rounded-[5px] border border-sap-border bg-sap-surface">
        <Combobox.Empty className={comboboxClassNames.empty}>
          No matches
        </Combobox.Empty>
        <Combobox.List className={comboboxClassNames.list}>
          {(option: string) => (
            <Combobox.Item
              key={option}
              value={option}
              className={comboboxClassNames.item}
            >
              {labels?.[option] ?? option}
              <Combobox.ItemIndicator
                className={comboboxClassNames.itemIndicator}
              >
                <Check aria-hidden />
              </Combobox.ItemIndicator>
            </Combobox.Item>
          )}
        </Combobox.List>
      </div>
    </Combobox.Root>
  );
}
