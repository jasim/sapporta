import type { ColumnSchema } from "../types/schema";

// Minimal header: column name only. Sort / filter / rename header UI and
// presentation details are the consumer's job.
export function GridHeader({ schema }: { schema: ColumnSchema[] }) {
  return (
    <div className="grid-header" role="rowgroup">
      <div className="grid-row grid-row--header" role="row">
        {schema.map((col) => (
          <div
            key={col.id}
            className="grid-cell grid-cell--header"
            role="columnheader"
            data-col-id={col.id}
          >
            <div className="grid-cell__content">
              <span className="grid-header-label">{col.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
