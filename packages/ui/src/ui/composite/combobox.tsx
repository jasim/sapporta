import { useState, type Ref } from "react";
import { ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/ui/primitives/popover";
import { Button } from "@/ui/primitives/button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  CommandEmpty,
  CommandGroup,
} from "@/ui/primitives/command";
import { cn } from "@/ui/utils/cn";
import type { RowId } from "@sapporta/shared/row-id";

interface ComboboxListProps {
  value: RowId | null;
  options: Array<{ id: string; label: string }>;
  /** Called with the picked id. Empty string means "clear". */
  onPick: (id: string) => void;
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
export function ComboboxList({
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
}: ComboboxListProps) {
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
            <CommandItem onSelect={() => onPick("")} value="— Clear —">
              <span className="text-sap-muted italic">Clear</span>
            </CommandItem>
          )}
          {options.map((opt) => (
            <CommandItem
              key={opt.id}
              value={opt.label}
              onSelect={() => onPick(opt.id)}
            >
              {opt.label}
              {value === opt.id && (
                <span className="ml-auto text-xs text-sap-muted">✓</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

interface ComboboxProps {
  value: RowId | null;
  onChange: (value: RowId | null) => void;
  /** id → display label. */
  options: Record<string, string>;
  placeholder?: string;
  disabled?: boolean;
  /** Applied to the Button trigger. */
  className?: string;
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(options).map(([id, label]) => ({ id, label }));
  const selectedLabel = value != null ? options[value] : undefined;

  const handlePick = (id: string) => {
    onChange(id || null);
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
        <ComboboxList value={value} options={entries} onPick={handlePick} />
      </PopoverContent>
    </Popover>
  );
}
