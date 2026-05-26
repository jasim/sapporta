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
import { inferDisplayType } from "@/table/model/column-types";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { KeyedValues } from "@/lookup/types";
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
  fkOptions?: KeyedValues;
}

export function FormField({
  column,
  value,
  onChange,
  fkOptions,
}: FormFieldProps) {
  const type = inferDisplayType(column);
  const id = `field-${column.name}`;

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {column.header ?? column.name}
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

      {type === "fk" && fkOptions && Object.keys(fkOptions).length > 0 ? (
        <Select
          value={value != null ? String(value) : ""}
          onValueChange={(v) => onChange(v || null)}
        >
          <SelectTrigger id={id}>
            <SelectValue
              placeholder={`Select ${column.header ?? column.name}`}
            />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(fkOptions).map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
