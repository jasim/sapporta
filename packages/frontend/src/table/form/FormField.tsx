import { Checkbox } from "@sapporta/ui/checkbox";
import { Combobox, comboboxClassNames } from "@sapporta/ui/combobox";
import { cn } from "@sapporta/ui/cn";
import { Input } from "@sapporta/ui/input";
import { Label } from "@sapporta/ui/label";
import { isLookupValue } from "@sapporta/grid/lookup";
import { Check, ChevronDown, X } from "lucide-react";
import { LookupPicker } from "../../lookup";
import type { RecordFormFieldModel } from "./record-form-fields";

interface FormFieldProps {
  field: RecordFormFieldModel;
  value: unknown;
  issue?: string;
  onChange: (value: unknown) => void;
}

export function FormField({ field, value, issue, onChange }: FormFieldProps) {
  const { column } = field;
  const id = `field-${column.name}`;
  const errorId = `${id}-error`;
  const invalid = issue !== undefined;
  const accessibilityProps = {
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? errorId : undefined,
  };

  return (
    <div className="flex flex-col gap-2" data-invalid={invalid || undefined}>
      <Label htmlFor={id} className="text-sm font-medium">
        {column.label}
        {column.notNull && !column.hasDefault && (
          <span className="text-destructive ml-1">*</span>
        )}
      </Label>

      {field.kind === "checkbox" && (
        <div className="flex items-center pt-1">
          <Checkbox
            id={id}
            {...accessibilityProps}
            checked={!!value}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
        </div>
      )}

      {field.kind === "select" && (
        <Combobox.Root<string>
          items={field.options}
          value={typeof value === "string" ? value : null}
          onValueChange={(nextValue) => onChange(nextValue ?? null)}
        >
          <Combobox.InputGroup className={comboboxClassNames.inputGroup}>
            <Combobox.Input
              id={id}
              {...accessibilityProps}
              placeholder={`Select ${column.name}`}
              className={comboboxClassNames.input}
            />
            <Combobox.Clear
              aria-label="Clear selection"
              className={comboboxClassNames.action}
            >
              <X aria-hidden />
            </Combobox.Clear>
            <Combobox.Trigger
              aria-label="Open popup"
              className={cn(comboboxClassNames.action, "me-1")}
            >
              <ChevronDown aria-hidden />
            </Combobox.Trigger>
          </Combobox.InputGroup>
          <Combobox.Portal>
            <Combobox.Positioner
              align="start"
              sideOffset={4}
              className={comboboxClassNames.positioner}
            >
              <Combobox.Popup className={comboboxClassNames.popup}>
                <Combobox.Empty className={comboboxClassNames.empty}>
                  No results.
                </Combobox.Empty>
                <Combobox.List className={comboboxClassNames.list}>
                  {(option: string) => (
                    <Combobox.Item
                      key={option}
                      value={option}
                      className={comboboxClassNames.item}
                    >
                      {option}
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
      )}

      {field.kind === "date" && (
        <Input
          id={id}
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          {...accessibilityProps}
        />
      )}

      {field.kind === "timestamp" && (
        <Input
          id={id}
          type="datetime-local"
          step="1"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          {...accessibilityProps}
        />
      )}

      {field.kind === "currency" && (
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          value={value != null ? String(value) : ""}
          onChange={(e) => onChange(e.target.value)}
          {...accessibilityProps}
        />
      )}

      {(field.kind === "number" || field.kind === "percentage") && (
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          value={value != null ? String(value) : ""}
          onChange={(e) => onChange(e.target.value)}
          {...accessibilityProps}
        />
      )}

      {field.kind === "foreignKey" && (
        <LookupPicker
          id={id}
          lookup={field.lookup}
          value={isLookupValue(value) ? value : null}
          onChange={onChange}
          placeholder={`Select ${column.label}`}
          className="w-full"
          ariaInvalid={invalid}
          ariaDescribedBy={invalid ? errorId : undefined}
        />
      )}

      {field.kind === "text" &&
        (column.textDisplay ? (
          <textarea
            id={id}
            value={value != null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value)}
            {...accessibilityProps}
            className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        ) : (
          <Input
            id={id}
            type="text"
            value={value != null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value)}
            {...accessibilityProps}
          />
        ))}
      {issue && (
        <p id={errorId} className="text-sm text-destructive">
          {issue}
        </p>
      )}
    </div>
  );
}
