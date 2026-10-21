import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import type { LookupEntry, LookupValue } from "@sapporta/grid/lookup";
import type { LookupEntryRenderer } from "@sapporta/grid/column-preset";
import type { Json, Row, TableSchema } from "@sapporta/shared/contracts";
import { pickComputed, type RowDataStore, type TableRowData } from "./row-data";
import {
  mergeRowDisplays,
  type ColumnSlot,
  type ComputedRecord,
  type ReferenceSlotProps,
  type DisplayContext,
  type LabelSlotProps,
  type RowDisplays,
  type Slot,
} from "./row-display-types";

const NO_DISPLAYS: RowDisplays = {};
const rowDisplaysContext = createContext<RowDisplays>(NO_DISPLAYS);

/**
 * Draws the rows inside it with `displays`, merged over the displays of any
 * enclosing provider: by table, then by slot. Wrap the app's root in one for
 * the app's displays, and wrap a view in another to change how that view
 * draws rows.
 *
 * Keep `displays` stable (a module constant or `useMemo`): a new value
 * rebuilds the grids inside.
 */
export function RowDisplayProvider({
  displays,
  children,
}: {
  displays: RowDisplays;
  children?: ReactNode;
}) {
  const outer = useContext(rowDisplaysContext);
  const merged = useMemo(
    () =>
      outer === NO_DISPLAYS ? displays : mergeRowDisplays(outer, displays),
    [outer, displays],
  );
  return (
    <rowDisplaysContext.Provider value={merged}>
      {children}
    </rowDisplaysContext.Provider>
  );
}

/** The display slots of the nearest `RowDisplayProvider`, merged with the
 *  providers around it. */
export function useRowDisplays(): RowDisplays {
  return useContext(rowDisplaysContext);
}

/**
 * The text a table's `rowCaption` gives a row: `null` when the table has no
 * caption or the row has no value, `undefined` while a computed caption is
 * not loaded yet.
 */
export function rowCaptionText(
  schema: TableSchema | undefined,
  computed: ComputedRecord | undefined,
  row: Readonly<Row> | undefined,
): string | null | undefined {
  const caption = schema?.rowCaption;
  if (!schema || !caption) return null;
  const field = schema.computed?.find(
    (candidate) => candidate.name === caption,
  );
  if (field) {
    if (!computed || !(caption in computed)) return undefined;
    return formatComputedValue(computed[caption]!, field.kind);
  }
  const value = row?.[caption];
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

/** The computed field the table's caption reads, if its caption is one. */
export function rowCaptionField(
  schema: TableSchema | undefined,
): string | undefined {
  const caption = schema?.rowCaption;
  return caption && schema.computed?.some((field) => field.name === caption)
    ? caption
    : undefined;
}

function formatComputedValue(
  value: Json,
  kind: NonNullable<TableSchema["computed"]>[number]["kind"],
): string | null {
  if (value === null || value === "") return null;
  switch (kind) {
    case "number":
      return typeof value === "number" ? value.toLocaleString() : String(value);
    case "boolean":
      return value === true ? "Yes" : value === false ? "No" : String(value);
    case "json":
      return JSON.stringify(value);
    default:
      return String(value);
  }
}

/**
 * Sapporta's own drawing of a row's identity: the label, with the table's
 * caption under it in smaller, muted text. Grid cells and views that already
 * show the row's place in its tree draw the label alone.
 */
export function DefaultRowLabel({
  label,
  labelContent,
  caption,
}: {
  label: string;
  /** What draws the label, when it is more than the text, such as a link. */
  labelContent?: ReactNode;
  caption?: string | null;
}) {
  if (!caption)
    return labelContent ?? <span className="truncate">{label}</span>;
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="truncate" title={label}>
        {labelContent ?? label}
      </span>
      <span
        className="truncate text-sap-meta text-sap-muted"
        title={caption}
        data-row-caption=""
      >
        {caption}
      </span>
    </span>
  );
}

// The caption shows where a row is picked or read on its own: options, the
// selected value and record fields. Grid cells stay one line, chips carry the
// label only, and a view that shows the tree already shows what a parent
// path would say.
function showsDefaultCaption(context: DisplayContext): boolean {
  if (context.hierarchyShown) return false;
  switch (context.surface) {
    case "option":
    case "selected":
    case "field":
      return true;
    case "cell":
    case "chip":
      return false;
  }
}

/**
 * The fields a row label asks for on a surface: its slot's `needs`, and the
 * table's computed caption where the default drawing shows it.
 */
export function rowLabelFields(
  slot: Slot<LabelSlotProps> | undefined,
  schema: TableSchema | undefined,
  context: DisplayContext,
): readonly string[] {
  const fields = new Set(slot?.needs ?? []);
  const caption = rowCaptionField(schema);
  if (caption && showsDefaultCaption(context)) fields.add(caption);
  return Array.from(fields);
}

/**
 * Draws one row's identity with its table's `label` slot: an option, a
 * reference cell, the row's own label cell, a picker's selected value.
 *
 * The slot's `render` is drawn once every field it `needs` is known. Until
 * then, Sapporta's default is drawn: the label, and the caption where the
 * surface shows one.
 */
export function RowLabel({
  data,
  id,
  label,
  context,
  row,
  labelContent,
}: {
  /** The row data of the row's table, from a row store. */
  data: TableRowData;
  id: LookupValue;
  label: string;
  context: DisplayContext;
  row?: Readonly<Row>;
  /** What draws the bare label, such as the grid's link-styled text. */
  labelContent?: ReactNode;
}) {
  const schema = data.schema();
  const slot = data.labelSlot();
  const fields = rowLabelFields(slot, schema, context);
  const computed = useRowComputedRecord(data, id, fields);

  const caption = showsDefaultCaption(context)
    ? rowCaptionText(schema, computed, row ?? undefined)
    : null;
  // Beside a picker's input the input shows the label already, so the
  // default there is the caption alone.
  const selectedSurface = context.surface === "selected";
  const defaultContent = selectedSurface ? (
    caption ? (
      <span className="truncate" title={caption} data-row-caption="">
        {caption}
      </span>
    ) : null
  ) : (
    <DefaultRowLabel
      label={label}
      labelContent={labelContent}
      caption={caption}
    />
  );

  const Render = slot?.render;
  const needs = slot?.needs ?? [];
  if (!Render || !data.hasComputed(id, needs)) return defaultContent;
  return (
    <Render
      id={id}
      label={label}
      computed={pickComputed(computed, needs)}
      context={context}
      defaultContent={defaultContent}
      {...(row ? { row } : {})}
    />
  );
}

/**
 * The computed values of one row, asking the store for the named fields that
 * are not known yet. The component draws again when a value arrives, and
 * asks again after the store's values are invalidated.
 */
export function useRowComputedRecord(
  data: TableRowData,
  id: LookupValue | null | undefined,
  fields: readonly string[],
): ComputedRecord | undefined {
  const fieldsKey = fields.join("\u0000");
  const subscribe = useCallback(
    (listener: () => void) => data.subscribeToComputed(listener),
    [data],
  );
  const record = useSyncExternalStore(subscribe, () =>
    id == null ? undefined : data.computedFor(id),
  );
  const generation = useSyncExternalStore(subscribe, () => data.generation);
  useEffect(() => {
    if (id == null || fields.length === 0) return;
    void data.ensureComputed([id], fields);
    // `fieldsKey` stands for `fields`, which callers often rebuild per render.
  }, [data, id, fieldsKey, generation]);
  return record;
}

/**
 * A `renderEntry` for a foreign-key column of `source.table`: it draws each
 * referenced row with the label slot of the table it references.
 */
export function referenceEntryRenderer(args: {
  /** The row data of the referenced table. */
  data: TableRowData;
  source: DisplayContext["source"];
  hierarchyShown: boolean;
}): LookupEntryRenderer {
  const slot = args.data.labelSlot();
  return ({ entry, surface, density, selected, defaultContent }) =>
    // Without a slot, a cell draws the label alone, which is what the column
    // drew already.
    !slot && surface === "cell" ? (
      defaultContent
    ) : (
      <RowLabel
        data={args.data}
        id={entry.value}
        label={entry.label}
        row={rowOfEntry(entry)}
        labelContent={defaultContent}
        context={{
          as: "reference",
          surface,
          density,
          source: args.source,
          hierarchyShown: args.hierarchyShown,
          ...(selected !== undefined ? { selected } : {}),
        }}
      />
    );
}

function rowOfEntry(entry: LookupEntry): Readonly<Row> | undefined {
  const meta = entry.meta;
  return typeof meta === "object" && meta !== null
    ? (meta as Readonly<Row>)
    : undefined;
}

/**
 * Draws one cell of a table's own rows with the column's slot. On a
 * foreign-key column, the slot also receives the referenced row, with the
 * values of `referenceNeeds`. `render` is drawn once every field the slot
 * needs is known; until then, the column's default cell is drawn.
 */
export function ColumnSlotCell({
  data,
  slot,
  id,
  value,
  row,
  context,
  defaultContent,
  reference,
}: {
  /** The row data of the cell's own table. */
  data: TableRowData;
  slot: ColumnSlot;
  id: LookupValue;
  value: unknown;
  row: Readonly<Row>;
  context: DisplayContext;
  defaultContent: ReactNode;
  /** For a foreign-key column: the referenced table's row data. */
  reference?: TableRowData;
}) {
  const needs = slot.needs ?? [];
  const referenceNeeds = slot.referenceNeeds ?? [];
  const referenceId = reference && isLookupValueish(value) ? value : null;
  const computed = useRowComputedRecord(data, id, needs);
  const referenceComputed = useRowComputedRecord(
    reference ?? data,
    reference ? referenceId : null,
    referenceNeeds,
  );
  const entry = useReferenceEntry(reference, referenceId);

  const Render = slot.render as ComponentType<ReferenceSlotProps> | undefined;
  if (!Render) return defaultContent;
  if (!data.hasComputed(id, needs)) return defaultContent;
  if (
    reference &&
    referenceId !== null &&
    !reference.hasComputed(referenceId, referenceNeeds)
  ) {
    return defaultContent;
  }
  return (
    <Render
      value={value}
      row={row}
      computed={pickComputed(computed, needs)}
      context={context}
      defaultContent={defaultContent}
      reference={
        referenceId !== null && entry
          ? {
              id: referenceId,
              label: entry.label,
              computed: pickComputed(referenceComputed, referenceNeeds),
            }
          : null
      }
    />
  );
}

function useReferenceEntry(
  reference: TableRowData | undefined,
  id: LookupValue | null,
): LookupEntry | undefined {
  const subscribe = useCallback(
    (listener: () => void) =>
      reference?.valueLookup.subscribeToLookupChanges(listener) ??
      (() => undefined),
    [reference],
  );
  return useSyncExternalStore(subscribe, () =>
    reference && id !== null
      ? reference.valueLookup.entryForValue(id)
      : undefined,
  );
}

function isLookupValueish(value: unknown): value is LookupValue {
  return (
    (typeof value === "string" && value !== "") || typeof value === "number"
  );
}

const rowDataStoreContext = createContext<RowDataStore | null>(null);

/** Makes `store` the row store that `useRowComputed` reads below it. A
 *  table grid provides its session's store to its cells. */
export function RowDataStoreProvider({
  store,
  children,
}: {
  store: RowDataStore;
  children?: ReactNode;
}) {
  return (
    <rowDataStoreContext.Provider value={store}>
      {children}
    </rowDataStoreContext.Provider>
  );
}

/** The nearest row store, or `null` outside a grid or provider. */
export function useRowDataStore(): RowDataStore | null {
  return useContext(rowDataStoreContext);
}

/**
 * Computed values of one row, for components that draw outside the display
 * slots, such as a custom cell:
 *
 * ```ts
 * const { onHand } = useRowComputed("items", itemId, ["onHand"]) ?? {};
 * ```
 *
 * It returns `undefined` until every named field is known, then exactly the
 * named fields. Calls made in the same render are sent as one request per
 * table. It reads the nearest row store: a table grid's, or one given by
 * `RowDataStoreProvider`.
 */
export function useRowComputed(
  table: string,
  id: LookupValue | null | undefined,
  fields: readonly string[],
): Readonly<Record<string, Json>> | undefined {
  const store = useRowDataStore();
  if (!store) {
    throw new Error(
      "useRowComputed needs a row store: use it inside a table grid, or wrap the component in RowDataStoreProvider.",
    );
  }
  const data = store.table(table);
  const record = useRowComputedRecord(data, id, fields);
  if (id == null || !data.hasComputed(id, fields)) return undefined;
  return pickComputed(record, fields);
}
