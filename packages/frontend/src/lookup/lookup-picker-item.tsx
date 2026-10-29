import type { ReactNode } from "react";
import type { LookupEntry, LookupValue } from "@sapporta/grid/lookup";
import type { LookupPickerItemDisplay } from "./LookupPicker";

/** Draws one option with the picker's `itemDisplay`, or its default. */
export function LookupPickerItemContent<TValue extends LookupValue, TMeta>({
  entry,
  itemDisplay,
  defaultContent,
}: {
  entry: LookupEntry<TValue, TMeta>;
  itemDisplay: LookupPickerItemDisplay<TValue, TMeta> | undefined;
  defaultContent: ReactNode;
}) {
  if (itemDisplay === undefined || !hasLookupEntryMeta(entry)) {
    return defaultContent;
  }

  if (itemDisplay.component !== undefined) {
    const ItemComponent = itemDisplay.component;
    return <ItemComponent entry={entry} defaultContent={defaultContent} />;
  }

  if (itemDisplay.fields.length === 0 || !isObject(entry.meta)) {
    return defaultContent;
  }
  const meta = entry.meta;

  return (
    <span
      className="grid min-w-0 flex-1 items-center"
      style={{
        gridTemplateColumns: `repeat(${itemDisplay.fields.length}, minmax(0, 1fr))`,
      }}
    >
      {itemDisplay.fields.map((field, index) => (
        <span key={`${field}:${index}`} className="flex min-w-0 items-center">
          <span className="min-w-0 flex-1 truncate">
            {formatLookupFieldValue(Reflect.get(meta, field))}
          </span>
          {index < itemDisplay.fields.length - 1 && (
            <span
              aria-hidden="true"
              className="shrink-0 px-2 text-muted-foreground"
            >
              |
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

function hasLookupEntryMeta<TValue extends LookupValue, TMeta>(
  entry: LookupEntry<TValue, TMeta>,
): entry is LookupEntry<TValue, TMeta> & { meta: TMeta } {
  return entry.meta !== undefined;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function formatLookupFieldValue(value: unknown): string {
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return "";
}
