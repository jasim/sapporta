import { and, type SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { TableCatalog } from "../schema/catalog.js";
import type { TableDef } from "../schema/table.js";
import type { RequestDataAuthority } from "./request-data-authority.js";
import {
  AuthPayloadPolicyError,
  clientPayloadPolicyIssues,
  requireResolvedTableReferences,
  trustedInsertValuesForDataAuthority,
} from "./schema-validation.js";
import {
  selectRowAccessPredicate,
  validateForeignKeyReferences,
  validateForeignKeyReferencesSync,
} from "./row-access.js";

/**
 * Request-bound security helpers for one table.
 *
 * Build these from `auth.rowSecurity.forTable(tableDef)` inside a handler.
 * Every method uses request data authority plus the loaded table
 * catalog, so callers do not pass ownership fields or table sets around by
 * hand.
 *
 * CASL is intentionally outside this interface. Routes decide whether a
 * principal may use a feature; these helpers decide which rows that feature may
 * safely read, write, or reference.
 */
export interface TableRowSecurity {
  /**
   * Low-level helper that stamps trusted ownership fields on an already-safe
   * object. Prefer `insertValues()` for normal client create bodies because it
   * also rejects server-managed references and validates FK visibility.
   */
  addOwnershipFields<T extends Record<string, unknown>>(
    input: T,
  ): T & Record<string, unknown>;

  /**
   * Rejects client-submitted ownership fields such as `workspace_id` and
   * `scoped_to_user_id`. This does not check server-managed references; use
   * `insertValues()` or `patchValues()` for normal write paths.
   */
  ensureOwnership<T extends Record<string, unknown>>(input: T): T;
  ensureOwnership(input: unknown): Record<string, unknown>;

  /**
   * Prepares one client create payload for Drizzle `insert().values(...)`.
   *
   * The helper rejects client ownership tampering, rejects client-submitted
   * `clientCanSet: false` references, merges trusted `serverValues`, validates
   * final FK visibility inside request data authority, and stamps
   * trusted ownership fields from auth.
   */
  insertValues<T extends Record<string, unknown>>(
    db: BetterSQLite3Database,
    input: T,
    options?: InsertValuesOptions<T>,
  ): Promise<T & Record<string, unknown>>;
  insertValues(
    db: BetterSQLite3Database,
    input: unknown,
    options?: InsertValuesOptions<Record<string, unknown>>,
  ): Promise<Record<string, unknown>>;

  /**
   * Synchronous variant for better-sqlite3 transaction callbacks.
   */
  insertValuesSync<T extends Record<string, unknown>>(
    db: BetterSQLite3Database,
    input: T,
    options?: InsertValuesOptions<T>,
  ): T & Record<string, unknown>;
  insertValuesSync(
    db: BetterSQLite3Database,
    input: unknown,
    options?: InsertValuesOptions<Record<string, unknown>>,
  ): Record<string, unknown>;

  /**
   * Prepares multiple client create payloads with the same guarantees as
   * `insertValues()`. Empty batches are rejected so callers do not accidentally
   * pass ambiguous SQL input to Drizzle.
   */
  insertManyValues<T extends Record<string, unknown>>(
    db: BetterSQLite3Database,
    inputs: readonly T[],
    options?: InsertValuesOptions<T>,
  ): Promise<Array<T & Record<string, unknown>>>;

  /**
   * Returns the table visibility predicate for the request data authority.
   * When `predicate` is supplied, it is AND-composed with the ownership
   * predicate for safe reads, updates, and deletes.
   */
  ownedRows(predicate?: SQL): SQL;

  /**
   * Prepares one client update patch for Drizzle `update().set(...)`.
   *
   * The helper rejects ownership tampering and client-submitted
   * `clientCanSet: false` references, then validates submitted FK values. It
   * never stamps ownership fields; updates must not silently rewrite ownership.
   */
  patchValues<T extends Record<string, unknown>>(
    db: BetterSQLite3Database,
    patch: T,
  ): Promise<T>;
  patchValues(
    db: BetterSQLite3Database,
    patch: unknown,
  ): Promise<Record<string, unknown>>;

  /**
   * Low-level FK visibility check for trusted payloads. Normal client writes
   * should call `insertValues()` or `patchValues()` so client-vs-server fields
   * are handled before reference validation.
   */
  validateReferences(
    db: BetterSQLite3Database,
    payload: unknown,
  ): Promise<void>;
  validateReferencesSync(db: BetterSQLite3Database, payload: unknown): void;
}

export interface RowSecurity {
  /**
   * Binds request auth and the loaded table catalog to one table's row-scope and
   * reference metadata. Use a separate guard for every table touched by a
   * workflow.
   */
  forTable(tableDef: TableDef): TableRowSecurity;

  /**
   * Returns a row-security engine narrowed to a more specific data authority.
   * Exact route authorization helpers use this after validating the workflow's
   * required authority slot.
   */
  withDataAuthority(dataAuthority: RequestDataAuthority): RowSecurity;
}

export interface InsertValuesOptions<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Trusted values authored by server code after client policy checks, such as
   * a parent row id in a master-detail insert. These values may include
   * references marked `clientCanSet: false`; final FK visibility is still
   * validated after they are merged.
   */
  serverValues?:
    | Record<string, unknown>
    | ((input: T, index: number) => Record<string, unknown>);
}

export interface CreateRowSecurityOptions {
  /** Loaded table catalog used to resolve FK metadata and validate visibility. */
  catalog: TableCatalog;
}

/**
 * Creates request-bound row security from request data authority and
 * the loaded table catalog. Project auth constructs this once per request and
 * exposes it as `auth.rowSecurity`.
 *
 * `dataAuthority` is the only source for trusted ownership values. Do
 * not pass user ids or workspace ids separately into table workflows; doing so
 * would create a second row-access model for callers to reconcile.
 */
export function createRowSecurity(
  dataAuthority: RequestDataAuthority,
  options: CreateRowSecurityOptions,
): RowSecurity {
  return {
    withDataAuthority(nextDataAuthority) {
      return createRowSecurity(nextDataAuthority, options);
    },

    forTable(tableDef) {
      function ensureOwnership<T extends Record<string, unknown>>(input: T): T;
      function ensureOwnership(input: unknown): Record<string, unknown>;
      function ensureOwnership(input: unknown): Record<string, unknown> {
        const errors = clientPayloadPolicyIssues(tableDef, input, []);
        if (errors.length > 0) {
          throw new AuthPayloadPolicyError(errors);
        }
        return input as Record<string, unknown>;
      }

      function ensureClientPayload(input: unknown): Record<string, unknown> {
        const errors = clientPayloadPolicyIssues(
          tableDef,
          input,
          referencesFor(tableDef),
        );
        if (errors.length > 0) {
          throw new AuthPayloadPolicyError(errors);
        }
        return input as Record<string, unknown>;
      }

      async function prepareInsert<T extends Record<string, unknown>>(
        db: BetterSQLite3Database,
        input: T,
        index: number,
        insertOptions: InsertValuesOptions<T> = {},
      ): Promise<T & Record<string, unknown>> {
        return prepareInsertSync(db, input, index, insertOptions);
      }

      function prepareInsertSync<T extends Record<string, unknown>>(
        db: BetterSQLite3Database,
        input: T,
        index: number,
        insertOptions: InsertValuesOptions<T> = {},
      ): T & Record<string, unknown> {
        // Keep the trust boundary explicit: validate the client shape first,
        // merge server-authored fields second, then validate the final graph.
        const safe = ensureClientPayload(input) as T;
        const trustedValues = resolveServerValues(insertOptions, safe, index);
        const merged = { ...safe, ...trustedValues };
        validateReferencesSync(db, merged);
        return {
          ...merged,
          ...trustedInsertValuesForDataAuthority(dataAuthority, tableDef).sql,
        };
      }

      async function validateReferences(
        db: BetterSQLite3Database,
        payload: unknown,
      ): Promise<void> {
        await validateForeignKeyReferences(
          db,
          dataAuthority,
          tableDef,
          payload,
          options.catalog.tables,
          {
            ...options,
            skipPayloadPolicy: true,
          },
        );
      }

      function validateReferencesSync(
        db: BetterSQLite3Database,
        payload: unknown,
      ): void {
        validateForeignKeyReferencesSync(
          db,
          dataAuthority,
          tableDef,
          payload,
          options.catalog.tables,
          {
            ...options,
            skipPayloadPolicy: true,
          },
        );
      }

      return {
        addOwnershipFields(input) {
          return {
            ...input,
            ...trustedInsertValuesForDataAuthority(dataAuthority, tableDef).sql,
          };
        },

        ensureOwnership,

        insertValues(
          db: BetterSQLite3Database,
          input: Record<string, unknown>,
          insertOptions?: InsertValuesOptions<Record<string, unknown>>,
        ) {
          return prepareInsert(db, input, 0, insertOptions);
        },

        insertValuesSync(
          db: BetterSQLite3Database,
          input: Record<string, unknown>,
          insertOptions?: InsertValuesOptions<Record<string, unknown>>,
        ) {
          return prepareInsertSync(db, input, 0, insertOptions);
        },

        async insertManyValues(db, inputs, insertOptions) {
          if (inputs.length === 0) {
            throw new AuthPayloadPolicyError([
              { field: "$", message: "Expected at least one row to insert." },
            ]);
          }

          const values = [];
          for (let index = 0; index < inputs.length; index += 1) {
            values.push(
              await prepareInsert(db, inputs[index]!, index, insertOptions),
            );
          }
          return values;
        },

        ownedRows(predicate) {
          const ownershipPredicate = selectRowAccessPredicate(
            dataAuthority,
            tableDef,
          );
          return predicate
            ? and(predicate, ownershipPredicate)!
            : ownershipPredicate;
        },

        async patchValues(db: BetterSQLite3Database, patch: unknown) {
          const safe = ensureClientPayload(patch);
          await validateReferences(db, safe);
          return safe;
        },

        validateReferences,
        validateReferencesSync,
      };
    },
  };

  function referencesFor(tableDef: TableDef) {
    return requireResolvedTableReferences(tableDef, options.catalog.tables);
  }
}

function resolveServerValues<T extends Record<string, unknown>>(
  options: InsertValuesOptions<T>,
  input: T,
  index: number,
): Record<string, unknown> {
  const serverValues = options.serverValues;
  if (!serverValues) return {};
  return typeof serverValues === "function"
    ? serverValues(input, index)
    : serverValues;
}
