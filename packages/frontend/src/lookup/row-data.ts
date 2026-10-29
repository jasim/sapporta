import type { LookupValue } from "@sapporta/grid/lookup";
import {
  MAX_LOOKUP_IDS,
  type ComputedValues,
  type Json,
  type TableSchema,
} from "@sapporta/shared/contracts";
import { toRecordId, type RecordId } from "@sapporta/shared/record-id";
import { fetchLookup, type LookupNarrowing } from "./api/lookup";
import type {
  ComputedRecord,
  LabelSlotProps,
  RowDisplays,
  Slot,
  TableDisplay,
} from "./row-display-types";
import {
  createTableLookupSource,
  type CachedTableLookupSource,
  type TableLookupSource,
} from "./source";
import type { LookupStore } from "./store";
import { useSchemaStore } from "../schema-catalog/state/schema-store";

/**
 * Everything a store knows about the rows of one table, keyed by id: the
 * lookup entries (labels) and the computed field values.
 *
 * Every response that carries rows of the table fills it: a page read, a
 * lookup, a create or an update. A row shown as itself and the same row
 * referenced from another table therefore share one set of values.
 */
export type TableRowData = TableLookupSource & {
  readonly tableName: string;
  /** Computed values known for this row, by field. The reference stays the
   *  same until a value changes. */
  computedFor(id: LookupValue): ComputedRecord | undefined;
  /** Whether every one of `fields` is known for the row. */
  hasComputed(id: LookupValue, fields: readonly string[]): boolean;
  /**
   * Asks for the fields of these rows that are not known yet. Calls made in
   * the same tick are sent together, as one lookup per table. A field that
   * could not be read is not asked for again until the values are
   * invalidated.
   */
  ensureComputed(
    ids: readonly LookupValue[],
    fields: readonly string[],
  ): Promise<void>;
  /**
   * Stores the `computed` member of a response for this table. `sentAt` is
   * the `generation` when the request was sent: values from a request sent
   * before the latest invalidation are drawn but read again.
   */
  storeComputed(values: ComputedValues, sentAt: number): void;
  /** Computed fields sent with every lookup of this table, so references
   *  arrive with what their default display draws. */
  lookupComputedFields(): readonly string[];
  /** The table's display slots, from the store's `rowDisplays`. */
  display(): TableDisplay | undefined;
  /** The table's `label` slot, if it declares one. */
  labelSlot(): Slot<LabelSlotProps> | undefined;
  /** The table's schema, when it is loaded. */
  schema(): TableSchema | undefined;
  /** Called whenever a value is stored or the values are invalidated. */
  subscribeToComputed(listener: () => void): () => void;
  /** Changes each time the values are invalidated. */
  readonly generation: number;
};

/**
 * A `LookupStore` that also holds the computed values of the rows it has
 * seen, and the display slots that draw them.
 */
export type RowDataStore = {
  /** A table's row data. With `narrowing`, its search offers only the rows
   *  that match; each narrowing has its own caches. */
  table(tableName: string, narrowing?: LookupNarrowing): TableRowData;
  foreignKey(
    column: Parameters<LookupStore["foreignKey"]>[0],
  ): TableRowData | undefined;
  requireForeignKey(
    args: Parameters<LookupStore["requireForeignKey"]>[0],
  ): TableRowData;
  clear(): void;
  /**
   * Marks every table's computed values as out of date, so the rows on
   * screen read them again. The old values stay drawn until the new ones
   * arrive. Call it after a write, since a value may depend on any row.
   */
  invalidateComputed(): void;
  /** Reads a table's labels again, such as after its rows were edited;
   *  every table's labels when no table is named. */
  reloadLabels(tableName?: string): void;
  /** The display slots the rows of this store are drawn with. */
  readonly rowDisplays: RowDisplays;
  /** The schema of a table, when it is loaded. */
  tableSchema(tableName: string): TableSchema | undefined;
};

export type RowDataStoreOptions = {
  /** Display slots by table. Their `needs` decide which computed fields
   *  lookups ask for. */
  rowDisplays?: RowDisplays;
  /** The table schemas, for each table's `rowCaption` and computed fields.
   *  Defaults to the tables the app's schema catalog has loaded. */
  tables?: () => readonly TableSchema[];
};

/**
 * Creates a store of the rows a page shows, by table: their labels for
 * references, and their computed field values. A table session owns one;
 * pass `rowDisplays` to draw its rows with display slots outside React.
 */
export function createLookupStore(
  options: RowDataStoreOptions = {},
): RowDataStore {
  const rowDisplays = options.rowDisplays ?? {};
  const tables = options.tables ?? (() => useSchemaStore.getState().tables);
  const byTable = new Map<string, TableRowDataSource>();

  const tableSchema = (tableName: string) =>
    tables().find((table) => table.name === tableName);

  function table(
    tableName: string,
    narrowing?: LookupNarrowing,
  ): TableRowDataSource {
    const key = narrowingKey(tableName, narrowing);
    const existing = byTable.get(key);
    if (existing) return existing;
    const created = new TableRowDataSource(tableName, {
      lookupFields: () =>
        lookupFieldsFor(tableName, rowDisplays, tableSchema, tables()),
      display: () => rowDisplays[tableName],
      schema: () => tableSchema(tableName),
      narrowing,
    });
    byTable.set(key, created);
    return created;
  }

  function foreignKey(
    column: Parameters<LookupStore["foreignKey"]>[0],
  ): TableRowData | undefined {
    return column.foreignKey ? table(column.foreignKey.table) : undefined;
  }

  return {
    table,
    foreignKey,
    requireForeignKey({ tableName, column }) {
      const lookup = foreignKey(column);
      if (lookup) return lookup;
      throw new Error(
        `Column '${tableName}.${column.name}' is not a foreign-key column.`,
      );
    },
    clear() {
      byTable.clear();
    },
    invalidateComputed() {
      for (const source of byTable.values()) source.invalidateComputed();
    },
    reloadLabels(tableName) {
      for (const source of byTable.values()) {
        if (tableName === undefined || source.tableName === tableName) {
          source.reloadLabels();
        }
      }
    },
    rowDisplays,
    tableSchema,
  };
}

// One cache per table and narrowing. A narrowing with no conditions is the
// table itself.
function narrowingKey(
  tableName: string,
  narrowing: LookupNarrowing | undefined,
): string {
  const filter = narrowing?.filter ?? [];
  if (filter.length === 0 && narrowing?.notUnder === undefined) {
    return tableName;
  }
  return `${tableName}\u0000${JSON.stringify([filter, narrowing?.notUnder ?? null])}`;
}

const connectedStores = new Set<RowDataStore>();

/**
 * Keeps `store` current with `invalidateRows` until the returned function is
 * called. Table grids and `useLookupStore` connect their stores while they
 * are mounted; connect a store made with `createLookupStore` the same way.
 */
export function connectRowDataStore(store: RowDataStore): () => void {
  connectedStores.add(store);
  return () => {
    connectedStores.delete(store);
  };
}

/**
 * Tells every connected row store that rows changed: computed values are
 * read again for the rows on screen, and the labels of `tableName` (every
 * table's, when none is named) are read again. Sapporta calls it after its
 * own writes; call it after your own endpoints write.
 */
export function invalidateRows(tableName?: string): void {
  invalidateRowsExcept(tableName, undefined);
}

/** `invalidateRows` for the stores other than `written`, which the caller
 *  has already brought up to date. */
export function invalidateRowsExcept(
  tableName: string | undefined,
  written: RowDataStore | undefined,
): void {
  for (const store of connectedStores) {
    if (store === written) continue;
    store.invalidateComputed();
    store.reloadLabels(tableName);
  }
}

/** The computed fields every lookup of a table carries: what its label slot
 *  needs, its `rowCaption` when that is a computed field, its tree's `path`,
 *  and the `referenceNeeds` of foreign-key column slots that point at it. */
function lookupFieldsFor(
  tableName: string,
  rowDisplays: RowDisplays,
  tableSchema: (tableName: string) => TableSchema | undefined,
  tables: readonly TableSchema[],
): readonly string[] {
  const fields = new Set(rowDisplays[tableName]?.label?.needs ?? []);
  const schema = tableSchema(tableName);
  const caption = schema?.rowCaption;
  if (caption && schema.computed?.some((field) => field.name === caption)) {
    fields.add(caption);
  }
  if (schema?.tree?.path) fields.add(schema.tree.path);
  for (const [sourceName, display] of Object.entries(rowDisplays)) {
    for (const [columnName, slot] of Object.entries(display.columns ?? {})) {
      if (!slot.referenceNeeds?.length) continue;
      const column = tables
        .find((table) => table.name === sourceName)
        ?.columns.find((candidate) => candidate.name === columnName);
      if (column?.foreignKey?.table !== tableName) continue;
      for (const field of slot.referenceNeeds) fields.add(field);
    }
  }
  return Array.from(fields);
}

class TableRowDataSource implements TableRowData {
  readonly tableName: string;
  readonly valueLookup: CachedTableLookupSource["valueLookup"];
  readonly searchLookup: CachedTableLookupSource["searchLookup"];
  readonly treeLookup: CachedTableLookupSource["treeLookup"];
  private readonly lookupFields: () => readonly string[];
  readonly display: () => TableDisplay | undefined;
  readonly schema: () => TableSchema | undefined;
  private readonly values = new Map<RecordId, ComputedRecord>();
  // Fields whose value was stored since the last invalidation. A value that
  // is stored but not fresh is still drawn while it is read again.
  private readonly fresh = new Map<RecordId, Set<string>>();
  // Fields a read could not return, which are not asked for again until the
  // next invalidation, so a failing read does not repeat in a loop.
  private readonly failed = new Map<RecordId, Set<string>>();
  private readonly inFlight = new Map<RecordId, Map<string, Promise<void>>>();
  private readonly queued = new Map<RecordId, Set<string>>();
  private queuedFlush: Promise<void> | undefined;
  private readonly listeners = new Set<() => void>();
  private currentGeneration = 0;

  constructor(
    tableName: string,
    args: {
      lookupFields: () => readonly string[];
      display: () => TableDisplay | undefined;
      schema: () => TableSchema | undefined;
      narrowing?: LookupNarrowing;
    },
  ) {
    this.tableName = tableName;
    this.lookupFields = args.lookupFields;
    this.display = args.display;
    this.schema = args.schema;
    const source = createTableLookupSource(
      tableName,
      () => {
        const sentAt = this.currentGeneration;
        return {
          fields: this.lookupFields(),
          store: (values) => this.storeComputed(values, sentAt),
        };
      },
      args.narrowing,
    );
    this.valueLookup = source.valueLookup;
    this.searchLookup = source.searchLookup;
    this.treeLookup = source.treeLookup;
  }

  get generation(): number {
    return this.currentGeneration;
  }

  lookupComputedFields(): readonly string[] {
    return this.lookupFields();
  }

  labelSlot(): Slot<LabelSlotProps> | undefined {
    return this.display()?.label;
  }

  computedFor(id: LookupValue): ComputedRecord | undefined {
    return this.values.get(toRecordId(id));
  }

  hasComputed(id: LookupValue, fields: readonly string[]): boolean {
    const record = this.values.get(toRecordId(id));
    return fields.every((field) => record !== undefined && field in record);
  }

  subscribeToComputed(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  storeComputed(computed: ComputedValues, sentAt: number): void {
    const current = sentAt === this.currentGeneration;
    let changed = false;
    for (const [field, byId] of Object.entries(computed)) {
      for (const [id, value] of Object.entries(byId)) {
        // A value read before the latest write still draws, but it may be
        // out of date, so it is read again.
        if (current) {
          markField(this.fresh, id, field);
          this.failed.get(id)?.delete(field);
        } else if (this.fresh.get(id)?.has(field)) {
          continue;
        }
        const record = this.values.get(id);
        if (record && field in record && record[field] === value) continue;
        this.values.set(id, { ...record, [field]: value });
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  ensureComputed(
    ids: readonly LookupValue[],
    fields: readonly string[],
  ): Promise<void> {
    if (fields.length === 0) return Promise.resolve();
    const waits: Promise<void>[] = [];
    for (const value of ids) {
      const id = toRecordId(value);
      for (const field of fields) {
        if (this.fresh.get(id)?.has(field)) continue;
        if (this.failed.get(id)?.has(field)) continue;
        const pending = this.inFlight.get(id)?.get(field);
        if (pending) {
          waits.push(pending);
          continue;
        }
        markField(this.queued, id, field);
      }
    }
    if (this.queued.size > 0) {
      this.queuedFlush ??= Promise.resolve().then(() => this.flush());
      waits.push(this.queuedFlush);
    }
    return Promise.all(waits).then(() => undefined);
  }

  invalidateComputed(): void {
    this.fresh.clear();
    this.failed.clear();
    // Requests in flight were sent before the write; slots wait on new ones.
    this.inFlight.clear();
    this.currentGeneration += 1;
    this.notify();
  }

  reloadLabels(): void {
    this.searchLookup.markSearchesStale();
    this.treeLookup.reload();
    this.valueLookup.reloadEntries().catch((error: unknown) => {
      console.error(
        `Could not read the labels of table '${this.tableName}' again.`,
        error,
      );
    });
  }

  // One lookup by ids for everything queued in this tick, with the union of
  // the fields: a row that misses one field gets them all, which keeps it to
  // one request per table.
  private async flush(): Promise<void> {
    this.queuedFlush = undefined;
    const ids = Array.from(this.queued.keys());
    const fields = Array.from(
      new Set(Array.from(this.queued.values(), (set) => [...set]).flat()),
    );
    this.queued.clear();
    const loads: Promise<void>[] = [];
    for (let start = 0; start < ids.length; start += MAX_LOOKUP_IDS) {
      const chunk = ids.slice(start, start + MAX_LOOKUP_IDS);
      const load = this.load(chunk, fields, this.currentGeneration);
      for (const id of chunk) {
        for (const field of fields) {
          const byField = this.inFlight.get(id) ?? new Map();
          byField.set(field, load);
          this.inFlight.set(id, byField);
        }
      }
      loads.push(load);
    }
    await Promise.all(loads);
  }

  private async load(
    ids: readonly RecordId[],
    fields: readonly string[],
    sentAt: number,
  ): Promise<void> {
    try {
      const response = await fetchLookup(this.tableName, ids, fields);
      this.storeComputed(response.computed ?? {}, sentAt);
      // After an invalidation, the fields are asked for again.
      if (sentAt !== this.currentGeneration) return;
      // An id the lookup does not return is a row this request cannot see
      // (or one that no longer exists); it has no values to wait for.
      for (const id of ids) {
        for (const field of fields) {
          if (!this.fresh.get(id)?.has(field))
            markField(this.failed, id, field);
        }
      }
    } catch (error) {
      if (sentAt !== this.currentGeneration) return;
      for (const id of ids) {
        for (const field of fields) markField(this.failed, id, field);
      }
      console.error(
        `Could not read computed fields ${fields.join(", ")} of table '${this.tableName}'.`,
        error,
      );
      this.notify();
    } finally {
      // An invalidation dropped this request's entries, and newer requests
      // may hold those keys now.
      if (sentAt === this.currentGeneration) {
        for (const id of ids) {
          const byField = this.inFlight.get(id);
          for (const field of fields) byField?.delete(field);
          if (byField?.size === 0) this.inFlight.delete(id);
        }
      }
    }
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }
}

function markField(
  map: Map<RecordId, Set<string>>,
  id: RecordId,
  field: string,
): void {
  const set = map.get(id) ?? new Set<string>();
  set.add(field);
  map.set(id, set);
}

/**
 * Whether a lookup is a table's row data, which draws its rows with display
 * slots, rather than another `LookupCapabilities`.
 */
export function isTableRowData(lookup: object): lookup is TableRowData {
  return lookup instanceof TableRowDataSource;
}

/** Picks the named fields of a computed record. */
export function pickComputed(
  record: ComputedRecord | undefined,
  fields: readonly string[],
): Readonly<Record<string, Json>> {
  const picked: Record<string, Json> = {};
  for (const field of fields) {
    if (record && field in record) picked[field] = record[field]!;
  }
  return picked;
}
