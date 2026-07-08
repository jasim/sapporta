import { useState, type Ref } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "../primitives/popover";
import { Button } from "../primitives/button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  CommandEmpty,
  CommandGroup,
} from "../primitives/command";
import { cn } from "../utils/cn";

type ComboboxValue = string | number;

interface ComboboxListProps<TValue extends ComboboxValue> {
  value: TValue | null;
  options: Array<{ id: TValue; label: string }>;
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

/** The searchable list body — Command + input + items. Exposed so grid-style
 *  editors can mount it inside their own Popover with custom focus handling.
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
  return (
    <Command shouldFilter={shouldFilter} className={className}>
      <CommandInput
        ref={inputRef}
        placeholder="Search…"
        value={searchText}
        onValueChange={onSearchTextChange}
        className={inputClassName}
      />
      <CommandList className={listClassName}>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup>
          {allowClear && (
            <CommandItem onSelect={() => onPick(null)} value="Clear">
              <span className="text-sap-muted italic">Clear</span>
            </CommandItem>
          )}
          {options.map((opt) => (
            <CommandItem
              key={comboboxKey(opt.id)}
              value={opt.label}
              onSelect={() => onPick(opt.id)}
            >
              {opt.label}
              {Object.is(value, opt.id) && (
                <span className="ml-auto text-xs text-sap-muted">✓</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

interface ComboboxProps<TValue extends ComboboxValue> {
  value: TValue | null;
  onChange: (value: TValue | null) => void;
  options: Array<{ id: TValue; label: string }>;
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
  const [open, setOpen] = useState(false);
  const selectedLabel =
    value != null
      ? options.find((option) => Object.is(option.id, value))?.label
      : undefined;

  const handlePick = (id: TValue | null) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn("justify-between font-normal", className)}
        >
          <span className={selectedLabel ? "" : "text-sap-muted"}>
            {selectedLabel ?? placeholder}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        sideOffset={4}
      >
        <ComboboxList value={value} options={options} onPick={handlePick} />
      </PopoverContent>
    </Popover>
  );
}

function comboboxKey(value: ComboboxValue): string {
  return `${typeof value}:${String(value)}`;
}
