import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "../ui/sheet";
import { Button } from "../ui/button";
import { FormField } from "./FormField";
import { useDrawerStore } from "../../stores/drawer-store";
import { useSchemaStore } from "../../stores/schema-store";
import { createRecord, closeDrawer } from "../../stores/dispatchers";
import { fetchLookupEntriesForSearch } from "../../services/lookup";
import { Loader2 } from "lucide-react";
import type { FkOptionsMap } from "../../types";
const EMPTY_FK_OPTIONS: FkOptionsMap = {};

export function RecordDrawer() {
  const { open, tableName } = useDrawerStore();
  const schema = useSchemaStore((s) =>
    s.tables.find((t) => t.name === tableName),
  );
  const [fkOptions, setFkOptions] = useState<FkOptionsMap>(EMPTY_FK_OPTIONS);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when drawer opens
  useEffect(() => {
    if (open && schema) {
      const initial: Record<string, unknown> = {};
      for (const col of schema.columns) {
        if (col.primary && col.hasDefault) continue;
        initial[col.name] = null;
      }
      setFormData(initial);
      setError(null);
    }
  }, [open, schema]);

  // Fetch FK options independently when drawer opens.
  //
  // RecordDrawer lives in AppShell (outside TableStoreProvider) so it can't
  // use the per-table controller. It fetches its own FK dropdown options
  // directly from the API. This also means the drawer's FK options are
  // always fresh — not stale from a previous table view.
  //
  // The `cancelled` flag prevents state updates if the drawer closes (and
  // the effect cleanup runs) before all fetches complete.
  useEffect(() => {
    if (!open || !schema) {
      setFkOptions(EMPTY_FK_OPTIONS);
      return;
    }

    const fkColumns = schema.columns.filter((c) => c.foreignKey !== null);
    if (fkColumns.length === 0) return;

    let cancelled = false;
    for (const col of fkColumns) {
      const fk = col.foreignKey!;
      fetchLookupEntriesForSearch({
        tableName: fk.table,
        searchText: "",
        limit: 5000,
      })
        .then((res) => {
          if (!cancelled) {
            setFkOptions((prev) => ({
              ...prev,
              [col.name]: Object.fromEntries(
                res.entries.map((entry) => [String(entry.value), entry.label]),
              ),
            }));
          }
        })
        .catch(() => {}); // non-critical
    }
    return () => {
      cancelled = true;
    };
  }, [open, schema]);

  if (!schema || !tableName) return null;

  // Which columns to show in the form
  const formColumns = schema.columns.filter((col) => {
    if (col.visuallyHidden) return false;
    if (col.primary && col.hasDefault) return false;
    return true;
  });

  function setField(name: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tableName) return;
    setSaving(true);
    setError(null);

    // Strip null values for fields that have defaults
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(formData)) {
      if (value !== null && value !== undefined) {
        data[key] = value;
      }
    }

    try {
      await createRecord(tableName, data);
    } catch (err: unknown) {
      const apiErr = err as {
        body?: {
          error?: string;
          details?: Array<{ field: string; message: string }>;
        };
      };
      if (apiErr.body?.details) {
        setError(
          apiErr.body.details.map((d) => `${d.field}: ${d.message}`).join(", "),
        );
      } else if (apiErr.body?.error) {
        setError(apiErr.body.error);
      } else {
        setError("Failed to save");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && closeDrawer()}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New {schema.label}</SheetTitle>
          <SheetDescription>
            Add a new record to {schema.label}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-6">
          {formColumns.map((col) => (
            <FormField
              key={col.name}
              column={col}
              value={formData[col.name]}
              onChange={(v) => setField(col.name, v)}
              fkOptions={fkOptions[col.name]}
            />
          ))}

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </Button>
            <Button type="button" variant="outline" onClick={closeDrawer}>
              Cancel
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
