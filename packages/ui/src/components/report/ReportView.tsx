import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Loader2, Play, Link as LinkIcon } from "lucide-react";
import { Temporal } from "@sapporta/shared";
import { useSchemaStore } from "../../stores/schema-store";
import { executeReport } from "../../services/reports";
import { fetchLookupEntriesForSearch } from "../../services/lookup";
import { TopBar } from "../layout/TopBar";
import { Input } from "../ui/input";
import { Combobox } from "../ui/combobox";
import { ReportGrid } from "./ReportGrid";
import { ReportSummaryStats } from "./ReportSummaryStats";
import { DateRangeField } from "./DateRangeField";
import {
  buildExecuteReportParams,
  flatReportParamsEqual,
  hasRelativeDateRangeInFormValues,
  inflateReportFormValues,
  readDateRangeReportFormValue,
  readScalarReportFormValue,
  serializeReportFormValues,
  snapshotReportFormValues,
  type FlatReportParams,
  type ReportFormValue,
  type ReportFormValues,
} from "./report-form-values";
import type { ReportParam, ReportResult } from "@sapporta/shared/contracts";
// ─── Helpers ──

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getDefaultDateValue(paramName: string): string {
  const today = new Date();
  if (paramName === "from_date") {
    return formatDate(new Date(today.getFullYear(), today.getMonth(), 1));
  }
  return formatDate(today);
}

function getDefaultValue(param: ReportParam): string {
  if (param.default !== undefined) return String(param.default);
  if (param.type === "date") return getDefaultDateValue(param.name);
  return "";
}

function buildDefaultFlatValues(params: ReportParam[]): FlatReportParams {
  const values: FlatReportParams = {};
  for (const p of params) {
    if (p.type === "daterange") continue;
    values[p.name] = getDefaultValue(p);
  }
  return values;
}

function buildInitialFormValues(
  params: ReportParam[],
  initialValues?: FlatReportParams,
): ReportFormValues {
  return inflateReportFormValues(params, {
    ...buildDefaultFlatValues(params),
    ...initialValues,
  });
}

function isEntityParam(param: ReportParam): boolean {
  return param.lookup != null;
}

// ─── EntitySelectField ──

function EntitySelectField({
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
    ? "Loading…"
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

// ─── ParamField ──

/** label: <input>  — label in subtle; input sized to the 26px affordance
 *  tier so the whole params row reads as a single flat strip. */
function ParamField({
  param,
  value,
  onChange,
}: {
  param: ReportParam;
  value: ReportFormValue | undefined;
  onChange: (value: ReportFormValue) => void;
}) {
  const label = (param.label ?? param.name.replace(/_/g, " ")).toLowerCase();

  // DateRangeField is a compound control — a Select plus conditional
  // date inputs — so it owns its own label chrome. Nesting it inside a
  // <label> would yield invalid HTML and the Select trigger would steal
  // focus from the label. Return the bare control instead.
  if (param.type === "daterange") {
    return (
      <DateRangeField
        label={param.label ?? param.name.replace(/_/g, " ")}
        required={false}
        value={readDateRangeReportFormValue(value)}
        onChange={onChange}
      />
    );
  }

  const scalarValue = readScalarReportFormValue(value);

  return (
    <label className="flex items-center gap-2 text-sap-data">
      <span className="text-sap-subtle">
        {label}
        {param.required && <span className="text-sap-negative ml-0.5">*</span>}
        {":"}
      </span>

      {isEntityParam(param) ? (
        <EntitySelectField
          param={param}
          value={scalarValue}
          onChange={onChange}
        />
      ) : param.type === "date" ? (
        <Input
          type="date"
          value={scalarValue}
          onChange={(e) => onChange(e.target.value)}
          className="h-sap-ctl w-[140px] text-sap-emph rounded-[5px] mono"
        />
      ) : param.type === "float" ? (
        <Input
          type="number"
          step="0.01"
          value={scalarValue}
          onChange={(e) => onChange(e.target.value)}
          className="h-sap-ctl w-[120px] text-sap-emph rounded-[5px] mono"
        />
      ) : param.type === "integer" ? (
        <Input
          type="number"
          step="1"
          value={scalarValue}
          onChange={(e) => onChange(e.target.value)}
          className="h-sap-ctl w-[100px] text-sap-emph rounded-[5px] mono"
        />
      ) : (
        <Input
          type="text"
          value={scalarValue}
          onChange={(e) => onChange(e.target.value)}
          className="h-sap-ctl w-[160px] text-sap-emph rounded-[5px]"
        />
      )}
    </label>
  );
}

// ─── ReportView ──

export interface ReportViewProps {
  reportName: string;
  initialValues?: FlatReportParams;
  onParamsChange?: (values: FlatReportParams) => void;
  /** Opt-in slot rendered above the results grid — typically a 4-column
   *  summary-stats strip (opening / total-dr / total-cr / closing for a
   *  ledger, for instance). Framework-generic, app-specific content. */
  summary?: (result: ReportResult) => ReactNode;
}

export function ReportView({
  reportName,
  initialValues,
  onParamsChange,
  summary,
}: ReportViewProps) {
  const reports = useSchemaStore((s) => s.reports);
  const report = reports.find((r) => r.name === reportName);

  const [values, setValues] = useState<ReportFormValues>(() =>
    report ? buildInitialFormValues(report.params, initialValues) : {},
  );
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const flatValues = useMemo(
    () => (report ? serializeReportFormValues(report.params, values) : {}),
    [report, values],
  );
  const flatValuesRef = useRef<FlatReportParams>({});
  const syncedReportNameRef = useRef<string | null>(null);

  const executeWithValues = useCallback(
    async (valuesArg: ReportFormValues, { silent }: { silent: boolean }) => {
      if (!report) return;

      const errors: string[] = [];
      for (const p of report.params) {
        if (p.type === "daterange") continue;
        if (p.required && !readScalarReportFormValue(valuesArg[p.name])) {
          errors.push(`${p.label ?? p.name} is required`);
        }
      }
      if (errors.length > 0) {
        if (!silent) setValidationErrors(errors);
        return;
      }
      setValidationErrors([]);

      const params = buildExecuteReportParams(report.params, valuesArg);

      setLoading(true);
      setError(null);
      try {
        const res = await executeReport(reportName, params);
        setResult(res);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to execute report",
        );
      } finally {
        setLoading(false);
      }
    },
    [report, reportName],
  );

  useEffect(() => {
    flatValuesRef.current = flatValues;
  }, [flatValues]);

  // Sync external URL/report changes into the local form state. Local edits
  // also update the URL, so we compare against the already-serialized current
  // state and skip no-op rehydrations.
  useEffect(() => {
    if (!report) return;

    const nextValues = buildInitialFormValues(report.params, initialValues);
    const nextFlatValues = serializeReportFormValues(report.params, nextValues);
    const reportChanged = syncedReportNameRef.current !== reportName;

    if (
      !reportChanged &&
      flatReportParamsEqual(flatValuesRef.current, nextFlatValues)
    ) {
      return;
    }

    syncedReportNameRef.current = reportName;
    setValues(nextValues);
    setResult(null);
    setError(null);
    setValidationErrors([]);
    executeWithValues(nextValues, { silent: true });
  }, [reportName, report, initialValues, executeWithValues]);

  const handleChange = useCallback(
    (paramName: string, value: ReportFormValue) => {
      if (!report) return;

      const nextValues = { ...values, [paramName]: value };
      setValues(nextValues);
      onParamsChange?.(serializeReportFormValues(report.params, nextValues));
    },
    [onParamsChange, report, values],
  );

  const runReport = useCallback(
    () => executeWithValues(values, { silent: false }),
    [executeWithValues, values],
  );

  const handleSubmit = useCallback(
    (e: { preventDefault: () => void }) => {
      e.preventDefault();
      runReport();
    },
    [runReport],
  );

  if (!report) {
    return (
      <div className="flex items-center justify-center h-full text-sap-muted">
        Report not found
      </div>
    );
  }

  const runButton = (
    <button
      type="button"
      onClick={runReport}
      disabled={loading}
      className="inline-flex items-center gap-[6px] h-sap-ctl px-[10px] rounded-[5px] text-sap-emph font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
    >
      {loading ? (
        <Loader2 className="h-[12px] w-[12px] animate-spin" />
      ) : (
        <Play className="h-[12px] w-[12px]" />
      )}
      Run report
    </button>
  );

  const hasRelativeDateRange = useMemo(
    () => hasRelativeDateRangeInFormValues(report.params, values),
    [report.params, values],
  );

  const copySnapshotLink = useCallback(async () => {
    const today = Temporal.Now.plainDateISO();
    const snapshotValues = snapshotReportFormValues(
      report.params,
      values,
      today,
    );
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(snapshotValues)) {
      if (v) qs.set(k, v);
    }
    const url = `${window.location.origin}${window.location.pathname}?${qs.toString()}`;
    await navigator.clipboard.writeText(url);
  }, [values, report.params]);

  const snapshotButton = hasRelativeDateRange ? (
    <button
      type="button"
      onClick={copySnapshotLink}
      title="Copy a link with relative ranges frozen to absolute dates"
      className="inline-flex items-center gap-[6px] h-sap-ctl px-[10px] rounded-[5px] text-sap-emph border border-sap-border bg-sap-surface"
    >
      <LinkIcon className="h-[12px] w-[12px]" />
      Copy snapshot link
    </button>
  ) : null;

  const actions = (
    <div className="flex items-center gap-2">
      {snapshotButton}
      {runButton}
    </div>
  );

  const rowsSubtitle = result ? `${countRows(result)} rows` : undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        section="Reports"
        title={report.label}
        subtitle={rowsSubtitle}
        actions={actions}
      />

      {report.params.length > 0 && (
        <form
          onSubmit={handleSubmit}
          className="shrink-0 flex items-center flex-wrap gap-x-5 gap-y-2 px-[14px] py-[8px] border-b border-sap-border bg-sap-chip"
        >
          {report.params.map((param) => (
            <ParamField
              key={param.name}
              param={param}
              value={values[param.name]}
              onChange={(v) => handleChange(param.name, v)}
            />
          ))}
          {/* Submit remains possible via Enter on any input */}
          <button type="submit" className="sr-only">
            Run
          </button>
        </form>
      )}

      {validationErrors.length > 0 && (
        <div className="shrink-0 px-[14px] py-[6px] border-b border-sap-border bg-sap-negative/10 text-sap-data text-sap-negative space-y-[2px]">
          {validationErrors.map((err) => (
            <div key={err}>{err}</div>
          ))}
        </div>
      )}

      {result?.errors && result.errors.length > 0 && (
        <div className="shrink-0 px-[14px] py-[6px] border-b border-sap-border bg-sap-negative/10 text-sap-data text-sap-negative space-y-[2px]">
          {result.errors.map((err, i) => (
            <div key={i}>
              <span className="font-medium">{err.path}:</span> {err.message}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="shrink-0 px-[14px] py-[6px] border-b border-sap-border bg-sap-negative/10 text-sap-data text-sap-negative">
          {error}
        </div>
      )}

      {result && summary ? (
        <div className="shrink-0 border-b border-sap-border bg-sap-surface">
          {summary(result)}
        </div>
      ) : result?.stats && result.stats.length > 0 ? (
        // Backend-declared stats render automatically when no `summary`
        // override is provided — the common path for reports that declare
        // a rollup at definition time.
        <div className="shrink-0 border-b border-sap-border bg-sap-surface">
          <ReportSummaryStats stats={result.stats} />
        </div>
      ) : null}

      <div className="flex-1 overflow-auto bg-sap-surface">
        {result ? (
          <ReportGrid
            nodes={result.data}
            levelColumns={result.levelColumns}
            footerRows={result.footerRows}
            levelOptions={result.levelOptions}
            levelLinks={result.levelLinks}
          />
        ) : (
          !loading &&
          !error && (
            <div className="flex items-center justify-center h-full text-sap-muted text-sap-body">
              Configure parameters and click &ldquo;Run report&rdquo;
            </div>
          )
        )}
      </div>
    </div>
  );
}

// Count total rows across all top-level nodes (used for the top-bar subtitle).
function countRows(result: ReportResult): number {
  return result.data.length;
}
