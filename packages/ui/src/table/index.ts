// Package entrypoint for Sapporta table runtime, grid, and session APIs.
// Keep this file as the narrative map: route-level entry points plus typed TGrid primitives.
export { createRecord, navigateToNewRecord } from "./actions/record-actions";
export * from "./api/rows";
export { FormField } from "./form/FormField";
export { NewRecordPage } from "./form/NewRecordPage";
export { RecordFormField } from "./form/RecordFormField";
export {
  RecordFormProvider,
  useRecordFieldValue,
  useRecordFormSetValue,
  useRecordFormStore,
} from "./form/RecordFormProvider";
export {
  compactRecordFormValues,
  createRecordFormStore,
  initialRecordFormValues,
  type RecordFormState,
  type RecordFormStore,
  type RecordFormValues,
} from "./form/record-form-store";
export * from "./grid-adapter/tgrid-filter";
export * from "./grid-adapter/tgrid-level-config";
export * from "./grid-adapter/tgrid-runtime-config";
export * from "./grid-adapter/tgrid-column-mapper";
export * from "./grid-adapter/tgrid-lookup-resolver";
export * from "./grid-adapter/tgrid-cell-context";
export * from "./grid-adapter/tgrid-column-builder";
export * from "./grid-adapter/tgrid-column-spec";
export * from "./grid-adapter/tgrid-schema-compiler";
export * from "./grid-adapter/tgrid-binding";
export * from "./grid-adapter/tgrid-types";
export * from "./lookup/tgrid-lookup-loading";
export * from "./lookup/table-lookup-registry";
export { TGrid } from "./page/TGrid";
export { TablePage } from "./page/TablePage";
export { TableToolbar } from "./page/TableToolbar";
export { Pagination } from "./pagination/Pagination";
export {
  visiblePaginationItems,
  type PaginationRangeItem,
} from "./pagination/visible-pagination-items";
export { NewRecordRoute } from "./route/NewRecordRoute";
export { TableRoute } from "./route/TableRoute";
export * from "./state/tgrid-level-query-state";
export {
  createTGridSession,
  type CreateTGridSessionArgs,
  type TGridSession,
} from "./state/tgrid-session";
export {
  reloadTGridRows,
  registerTGridSession,
  unregisterTGridSession,
} from "./state/tgrid-session-registry";
export * from "./url/table-url";
