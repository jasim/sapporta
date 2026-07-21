// Public table tools for app pages.
// Start with `SchemaTableGridView` for a standard table route. Use
// `buildSchemaTGridConfig` or `defineTGrid` when a page needs a custom grid.
export { createRecord, navigateToNewRecord } from "./actions/record-actions";
export * from "./api/rows";
export { FormField } from "./form/FormField";
export { NewRecordPage } from "./form/NewRecordPage";
export {
  parseCreateDraft,
  type CreateDraftIssue,
  type ParseCreateDraftResult,
} from "./form/parse-create-draft";
export {
  decodeTableValueDraft,
  parseTablePatchValueDraft,
  type TablePatchValueDraftParseResult,
  type TableValueDraftDecodeResult,
} from "./model/table-value-draft";
export {
  buildRecordFormFields,
  fieldModelForColumn,
  foreignKeyFieldModelForColumn,
  type ForeignKeyRecordFormFieldModel,
  type RecordFormFieldModel,
} from "./form/record-form-fields";
export * from "./grid-adapter/schema-tgrid";
export {
  defineTGrid,
  type TGridDefinition,
} from "./grid-adapter/tgrid-runtime-config";
export * from "./grid-adapter/tgrid-cell-context";
export type {
  TGridActiveRow,
  TGridRowActivatedEvent,
} from "./state/tgrid-active-row";
export * from "./grid-adapter/tgrid-column-spec";

export * from "./grid-adapter/tgrid-filter";
export * from "./grid-adapter/tgrid-level-config";
export * from "./grid-adapter/tgrid-column-mapper";
export * from "./grid-adapter/tgrid-column-builder";
export * from "./grid-adapter/tgrid-binding";
export * from "./grid-adapter/tgrid-types";
export * from "./grid-adapter/tgrid-table-url";
export {
  visiblePaginationItems,
  type PaginationRangeItem,
} from "./grid-adapter/visible-pagination-items";
export * from "./lookup/tgrid-lookup-loading";
export { TGrid } from "./page/TGrid";
export type {
  TGridPresentation,
  ViewRelatedRowsContext,
  ViewRelatedRowsOption,
} from "./page/TGrid";
export {
  TablePage,
  type TablePageGridOptions,
  type TablePageProps,
} from "./page/TablePage";
export {
  SchemaTableGridView,
  useSchemaTableGrid,
  type UseSchemaTableGridArgs,
  type SchemaTableGridViewSource,
  type SchemaTableGridViewProps,
} from "./page/SchemaTableGridView";
export {
  TableGridView,
  useTableGrid,
  type TableGridActionsProps,
  type TableGridBinding,
  type TableGridViewProps,
  type UseTableGridArgs,
} from "./page/TableGridView";
export * from "./page/table-grid-url-state";
export * from "./page/table-level-pager";
export * from "./page/table-level-query";
export * from "./page/table-page-mode";
export * from "./page/table-selection";
export * from "./page/table-view-pref";
export * from "./page/tgrid-lifecycle";
export * from "./page/tgrid-source-status";
export * from "./query";
export { NewRecordRoute } from "./route/NewRecordRoute";
export {
  TableRoute,
  type TableGridOptionsByTable,
  type TableRouteProps,
} from "./route/TableRoute";
export * from "./state/tgrid-level-query-state";
export {
  createTGridSession,
  type CreateTGridSessionArgs,
  type TGridRouteQuerySeed,
  type TGridSession,
} from "./state/tgrid-session";
export {
  reloadTGridRows,
  registerTGridSession,
  unregisterTGridSession,
} from "./state/tgrid-session-registry";
