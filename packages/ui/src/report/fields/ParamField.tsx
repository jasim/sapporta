import type { ReportParam } from "@sapporta/shared/contracts";
import { Input } from "@/ui/primitives/input";
import { DateRangeField } from "./DateRangeField";
import { EntitySelectField } from "./EntitySelectField";
import {
  readDateRangeReportFormValue,
  readScalarReportFormValue,
  type ReportFormValue,
} from "@/report/params/report-form-values";

function isEntityParam(param: ReportParam): boolean {
  return param.lookup != null;
}

/** label: <input> - label in subtle; input sized to the 26px affordance
 * tier so the whole params row reads as a single flat strip. */
export function ParamField({
  param,
  value,
  onChange,
}: {
  param: ReportParam;
  value: ReportFormValue | undefined;
  onChange: (value: ReportFormValue) => void;
}) {
  const label = (param.label ?? param.name.replace(/_/g, " ")).toLowerCase();

  // DateRangeField is a compound control: a Select plus conditional date
  // inputs, so it owns its own label chrome.
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
