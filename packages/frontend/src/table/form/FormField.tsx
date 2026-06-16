import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@sapporta/ui";
import { Label } from "@sapporta/ui";
import { Checkbox } from "@sapporta/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sapporta/ui";
import {
  Button,
  ComboboxList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@sapporta/ui";
import type { LookupCapabilities } from "@sapporta/grid/column-preset";
import { inferDisplayType } from "@/table/model/column-types";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { useLookupOptions } from "@sapporta/grid";
import {
  formatInstantForDateTimeLocalInput,
  formatPlainDateForDateInput,
  parseDateInputToPlainDateString,
  parseDateTimeLocalInputToCanonicalInstantString,
} from "@sapporta/shared/temporal";

interface FormFieldProps {
  column: ColumnSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  lookup?: LookupCapabilities;
}

export function FormField({ column, value, onChange, lookup }: FormFieldProps) {
  const type = inferDisplayType(column);
  const id = `field-${column.name}`;

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {column.label}
        {column.notNull && !column.hasDefault && (
          <span className="text-destructive ml-1">*</span>
        )}
      </Label>

      {type === "checkbox" && (
        <div className="flex items-center pt-1">
          <Checkbox
            id={id}
            checked={!!value}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
        </div>
      )}

      {type === "select" && column.select && (
        <Select
          value={value != null ? String(value) : ""}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder={`Select ${column.name}`} />
          </SelectTrigger>
          <SelectContent>
            {column.select.options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {type === "date" && (
        <Input
          id={id}
          type="date"
          value={formatPlainDateForDateInput(value)}
          onChange={(e) =>
            onChange(parseDateInputToPlainDateString(e.target.value))
          }
        />
      )}

      {type === "timestamp" && (
        <Input
          id={id}
          type="datetime-local"
          step="1"
          value={formatInstantForDateTimeLocalInput(value)}
          onChange={(e) =>
            onChange(
              parseDateTimeLocalInputToCanonicalInstantString(e.target.value),
            )
          }
        />
      )}

      {type === "currency" && (
        <Input
          id={id}
          type="number"
          step="0.01"
          value={value != null ? String(value) : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      )}

      {(type === "number" || type === "percentage") && (
        <Input
          id={id}
          type="number"
          value={value != null ? String(value) : ""}
          onChange={(e) =>
            onChange(e.target.value ? Number(e.target.value) : null)
          }
        />
      )}

      {type === "fk" && lookup?.searchLookup ? (
        <LookupFormField
          id={id}
          column={column}
          value={value}
          onChange={onChange}
          lookup={lookup}
        />
      ) : (
        type === "fk" && (
          <Input
            id={id}
            type="text"
            value={value != null ? String(value) : ""}
            placeholder={`${column.foreignKey!.table} ID`}
            onChange={(e) => onChange(e.target.value || null)}
          />
        )
      )}

      {(type === "text" || type === "pk") &&
        (type === "text" && column.textDisplay ? (
          <textarea
            id={id}
            value={value != null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value || null)}
            className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        ) : (
          <Input
            id={id}
            type="text"
            value={value != null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value || null)}
          />
        ))}
    </div>
  );
}

function LookupFormField({
  id,
  column,
  value,
  onChange,
  lookup,
}: {
  id: string;
  column: ColumnSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  lookup: LookupCapabilities;
}) {
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const selectedValue = value == null || value === "" ? null : String(value);
  const entries = useLookupOptions({
    valueLookup: lookup.valueLookup,
    searchLookup: lookup.searchLookup,
    selectedValues: selectedValue ? [selectedValue] : [],
    searchText,
    limit: 50,
  });
  const options = entries.map((entry) => ({
    id: String(entry.value),
    label: entry.label,
  }));

  const selectedLabel = selectedValue
    ? (entries.find((entry) => String(entry.value) === selectedValue)?.label ??
      selectedValue)
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
        >
          <span className={selectedLabel ? "" : "text-sap-muted"}>
            {selectedLabel ?? `Select ${column.label}`}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        sideOffset={4}
      >
        <ComboboxList
          value={selectedValue}
          options={options}
          onPick={(pickedId) => {
            onChange(pickedId || null);
            setOpen(false);
          }}
          searchText={searchText}
          onSearchTextChange={setSearchText}
          shouldFilter={false}
        />
      </PopoverContent>
    </Popover>
  );
}
