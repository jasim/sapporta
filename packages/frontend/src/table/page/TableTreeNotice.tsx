// A tree loads all its rows in one request. When the table has more rows than
// one request returns, some rows are missing, and a row whose parent is
// missing shows at the top level.
export function TableTreeNotice({
  loadedRowCount,
}: {
  loadedRowCount: number;
}) {
  return (
    <div
      role="status"
      data-table-tree-notice
      className="border-b border-sap-border-soft px-1 py-2 text-sap-body text-sap-muted"
    >
      {`Only the first ${loadedRowCount.toLocaleString()} rows are shown, so the tree may be missing rows. A row whose parent is not shown appears at the top level. Search or filter to find other rows.`}
    </div>
  );
}
