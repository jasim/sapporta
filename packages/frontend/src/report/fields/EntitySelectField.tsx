import { useEffect, useState } from "react";
import { fetchLookupEntriesForSearch } from "@/lookup/api/lookup";
import { Combobox } from "@sapporta/ui";
import type { ReportParam } from "@sapporta/shared/contracts";

export function EntitySelectField({
  param,
  value,
  onChange,
}: {
  param: ReportParam;
  value: string;
  onChange: (value: string) => void;
}) {
  const [options, setOptions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLookupEntriesForSearch({
      tableName: param.lookup!,
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
  }, [param.lookup]);

  const stringValue = value ? String(value) : null;
  const placeholder = loading
    ? "Loading options..."
    : `Select ${param.label ?? param.name}`;

  return (
    <Combobox
      value={stringValue}
      onChange={(v) => onChange(v ?? "")}
      options={options}
      placeholder={placeholder}
      className="h-sap-ctl min-w-[140px] text-sap-emph rounded-[5px]"
    />
  );
}
