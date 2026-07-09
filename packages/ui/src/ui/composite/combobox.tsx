import type { Ref } from "react";
import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "../primitives/button";
import { cn } from "../utils/cn";

type ComboboxValue = string | number;
type ComboboxOption<TValue extends ComboboxValue> = {
  id: TValue;
  label: string;
};

interface ComboboxListProps<TValue extends ComboboxValue> {
  value: TValue | null;
  options: Array<ComboboxOption<TValue>>;
  onPick: (id: TValue | null) => void;
  inputRef?: Ref<HTMLInputElement>;
  searchText?: string;
  onSearchTextChange?: (value: string) => void;
  shouldFilter?: boolean;
  allowClear?: boolean;
  className?: string;
  inputClassName?: string;
  listClassName?: string;
}

/** The searchable list body. Exposed so grid-style editors can mount it inside
 *  their own popup with custom focus handling.
 *  Most callers want `Combobox` instead. */
export function ComboboxList<TValue extends ComboboxValue>({
  value,
  options,
  onPick,
  inputRef,
  searchText,
  onSearchTextChange,
  shouldFilter,
  allowClear = true,
  className,
  inputClassName,
  listClassName,
}: ComboboxListProps<TValue>) {
  const selectedOption = optionForValue(options, value);

  return (
    <BaseCombobox.Root<ComboboxOption<TValue>, false>
      items={options}
      value={selectedOption}
      onValueChange={(option) => onPick(option?.id ?? null)}
      inputValue={searchText}
      onInputValueChange={(nextValue) => onSearchTextChange?.(nextValue)}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => String(option.id)}
      isItemEqualToValue={(item, selected) => Object.is(item.id, selected.id)}
      filter={shouldFilter === false ? null : undefined}
      open
    >
      <div
        className={cn(
          "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
          className,
        )}
      >
        <BaseCombobox.Input
          ref={inputRef}
          placeholder="Search…"
          className={cn(
            "flex h-9 w-full border-b bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
            inputClassName,
          )}
        />
        {allowClear && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="m-1 flex cursor-default gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
          >
            <span className="text-sap-muted italic">Clear</span>
          </button>
        )}
        <BaseCombobox.Empty>
          <div className="py-6 text-center text-sm">No results.</div>
        </BaseCombobox.Empty>
        <BaseCombobox.List
          className={cn(
            "max-h-[300px] overflow-y-auto overflow-x-hidden p-1",
            listClassName,
          )}
        >
          {(option: ComboboxOption<TValue>) => (
            <BaseCombobox.Item
              key={comboboxKey(option.id)}
              value={option}
              className="relative flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50"
            >
              <span>{option.label}</span>
              <BaseCombobox.ItemIndicator className="ml-auto text-sap-muted">
                <Check className="h-3.5 w-3.5" />
              </BaseCombobox.ItemIndicator>
            </BaseCombobox.Item>
          )}
        </BaseCombobox.List>
      </div>
    </BaseCombobox.Root>
  );
}

interface ComboboxProps<TValue extends ComboboxValue> {
  value: TValue | null;
  onChange: (value: TValue | null) => void;
  options: Array<ComboboxOption<TValue>>;
  placeholder?: string;
  disabled?: boolean;
  /** Applied to the Button trigger. */
  className?: string;
}

export function Combobox<TValue extends ComboboxValue>({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  className,
}: ComboboxProps<TValue>) {
  const selectedOption = optionForValue(options, value);

  return (
    <BaseCombobox.Root<ComboboxOption<TValue>, false>
      items={options}
      value={selectedOption}
      onValueChange={(option) => onChange(option?.id ?? null)}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => String(option.id)}
      isItemEqualToValue={(item, selected) => Object.is(item.id, selected.id)}
    >
      <BaseCombobox.Trigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn("justify-between font-normal", className)}
          />
        }
      >
        <span className={selectedOption ? "" : "text-sap-muted"}>
          {selectedOption?.label ?? placeholder}
        </span>
        <BaseCombobox.Icon
          render={<ChevronDown className="h-4 w-4 opacity-50" />}
        />
      </BaseCombobox.Trigger>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner align="start" sideOffset={4}>
          <BaseCombobox.Popup className="z-[var(--sap-z-popover)] w-[--anchor-width] overflow-hidden rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none transition-[opacity,transform] data-starting-style:opacity-0 data-ending-style:opacity-0 data-starting-style:scale-95 data-ending-style:scale-95">
            <BaseCombobox.Input
              placeholder="Search…"
              className="flex h-9 w-full border-b bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
            <BaseCombobox.Empty>
              <div className="py-6 text-center text-sm">No results.</div>
            </BaseCombobox.Empty>
            <BaseCombobox.List className="max-h-[300px] overflow-y-auto overflow-x-hidden p-1">
              {(option: ComboboxOption<TValue>) => (
                <BaseCombobox.Item
                  key={comboboxKey(option.id)}
                  value={option}
                  className="relative flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50"
                >
                  <span>{option.label}</span>
                  <BaseCombobox.ItemIndicator className="ml-auto text-sap-muted">
                    <Check className="h-3.5 w-3.5" />
                  </BaseCombobox.ItemIndicator>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}

function optionForValue<TValue extends ComboboxValue>(
  options: Array<ComboboxOption<TValue>>,
  value: TValue | null,
): ComboboxOption<TValue> | null {
  return value == null
    ? null
    : (options.find((option) => Object.is(option.id, value)) ?? null);
}

function comboboxKey(value: ComboboxValue): string {
  return `${typeof value}:${String(value)}`;
}
