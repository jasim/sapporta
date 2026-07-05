import { useEffect, useState } from "react";
import { fetchLookupEntriesForSearch } from "../../lookup/api/lookup";
import { Combobox } from "@sapporta/ui/combobox";

export function EntitySelectField({
  tableName,
  label,
  value,
  onChange,
  error,
}: {
  tableName: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}) {
  const [options, setOptions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLookupEntriesForSearch({
      tableName,
      searchText: "",
      limit: 5000,
    })
      .then((res) => {
        if (cancelled) return;
        setOptions(
          Object.fromEntries(
            res.entries.map((entry) => [String(entry.value), entry.label]),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setOptions({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tableName]);

  const stringValue = value ? String(value) : null;
  const placeholder = loading
    ? "Loading options..."
    : `Select ${label ?? tableName}`;

  return (
    <label className="flex items-center gap-2 text-sap-data">
      {label ? (
        <span className="text-sap-subtle">
          {label.toLowerCase()}
          {":"}
        </span>
      ) : null}
      <Combobox
        value={stringValue}
        onChange={(v) => onChange(v ?? "")}
        options={options}
        placeholder={placeholder}
        className="h-sap-ctl min-w-[140px] text-sap-emph rounded-[5px]"
      />
      {error ? <span className="text-sap-negative">{error}</span> : null}
    </label>
  );
}
