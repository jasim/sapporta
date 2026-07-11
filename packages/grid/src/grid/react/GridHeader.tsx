import type { ColumnSchema, RowHeaderColumn } from "../types/schema";

// Minimal header: column name only. Sort / filter / rename header UI and
// presentation details are the consumer's job.
export function GridHeader({
  schema,
  rowHeaderColumn,
}: {
  schema: readonly ColumnSchema[];
  rowHeaderColumn: RowHeaderColumn;
}) {
  return (
    <div data-grid-part="header" role="rowgroup">
      <div data-grid-part="header-row" role="row">
        {rowHeaderColumn === "empty-selectable-cell" ? (
          <div role="columnheader" data-grid-part="row-header-header-cell" />
        ) : null}
        {schema.map((col) => (
          <div
            key={col.id}
            role="columnheader"
            data-grid-part="header-cell"
            data-col-id={col.id}
          >
            <div data-grid-part="cell-content">
              <span data-grid-part="header-label">{col.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
