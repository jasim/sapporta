import { useEffect, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useSchemaStore } from "../stores/schema-store";
import { parseReportSearchParams, buildReportSearchParams } from "./url-helpers";
import { ReportView } from "../components/report/ReportView";
import { useKeyHints, type KeyHint } from "../stores/hints-store";

const REPORT_HINTS: KeyHint[] = [
  { key: "⌘K", desc: "command" },
  { key: "⌘E", desc: "export" },
];

export function ReportRoute() {
  useKeyHints(REPORT_HINTS);
  const { reportName } = useParams<{ reportName: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { loaded, reports } = useSchemaStore();
  const prevReportRef = useRef<string>("");

  const report = reports.find((r) => r.name === reportName);

  // Sync active report in schema store
  useEffect(() => {
    if (!loaded || !reportName || !report) return;
    if (prevReportRef.current === reportName) return;
    prevReportRef.current = reportName;

    useSchemaStore.getState().setActiveReport(reportName);
  }, [loaded, reportName, report]);

  const handleParamsChange = (values: Record<string, string>) => {
    setSearchParams(buildReportSearchParams(values), { replace: true });
  };

  if (!loaded) return null;
  if (!reportName || !report) {
    return (
      <div className="flex items-center justify-center h-full text-sap-muted">
        Report not found
      </div>
    );
  }

  // Parse initial values from URL (including the flat daterange keys)
  const urlValues = parseReportSearchParams(searchParams, report.params);

  return (
    <ReportView
      reportName={reportName}
      initialValues={urlValues}
      onParamsChange={handleParamsChange}
    />
  );
}
