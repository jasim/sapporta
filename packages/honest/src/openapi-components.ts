/**
 * Moves the definitions a route's JSON Schema carries into the OpenAPI
 * document's `components.schemas`.
 *
 * `z.toJSONSchema` writes a schema's shared parts as `definitions` beside it,
 * with refs relative to the schema's own root: `#/definitions/Account`, or
 * `#` for a recursive schema. In an OpenAPI document `#` is the document,
 * which has neither, so those refs led nowhere. A schema with a `.meta({ id })`
 * is written that way, and since zod 4.6 so is a root schema with one.
 *
 *   hoist({ $ref: "#/definitions/Account", definitions: { Account } })
 *     -> components.schemas.Account
 *     -> { $ref: "#/components/schemas/Account" }
 *
 * Each document gets its own `ComponentSchemas`, filled as its routes'
 * schemas are transformed. A definition named by an id keeps its name, and
 * one id naming two different schemas throws, as rest-open-api does for a
 * schema `title`. zod's own names (`__schema0`) are per schema, so those, and
 * the root of a schema that refers to itself, are named after the route and
 * shared only by equal schemas.
 */

export type JsonSchema = Record<string, unknown>;

/** Where rest-open-api is about to put a transformed schema. */
export type SchemaPlace = {
  /** The route's key in the router. */
  id: string;
  type: "path" | "query" | "header" | "body" | "response";
};

const DEFINITIONS_KEYWORDS = ["definitions", "$defs"] as const;
const COMPONENTS_POINTER = "#/components/schemas/";
const ZOD_GENERATED_NAME = /^__schema\d+$/;

// rest-open-api reads a parameter schema's properties to list the
// parameters, so its root stays inline.
const PARAMETER_TYPES = new Set<SchemaPlace["type"]>([
  "path",
  "query",
  "header",
]);

export class ComponentSchemas {
  readonly schemas: Record<string, JsonSchema> = {};

  /**
   * The schema to embed at `place`, with its definitions moved to
   * `this.schemas` and every local ref pointed at them.
   */
  hoist(schema: JsonSchema, place: SchemaPlace): JsonSchema {
    const definitions: Record<string, JsonSchema> = {};
    const root: JsonSchema = {};
    for (const [keyword, value] of Object.entries(schema)) {
      if (
        (DEFINITIONS_KEYWORDS as readonly string[]).includes(keyword) &&
        isObject(value)
      ) {
        Object.assign(definitions, value);
      } else {
        root[keyword] = value;
      }
    }
    const names = Object.keys(definitions);
    const refersToRoot = [root, ...Object.values(definitions)].some(hasRootRef);
    if (names.length === 0 && !refersToRoot) return schema;

    const base = `${place.id}_${place.type}`;
    const rootKey = "#";
    // How many times each name has been taken by a different schema.
    const taken = new Map<string, number>(
      [...names, rootKey].map((name) => [name, 0]),
    );
    const finalName = (name: string): string => {
      const preferred =
        name === rootKey
          ? base
          : ZOD_GENERATED_NAME.test(name)
            ? `${base}_${name}`
            : name;
      const times = taken.get(name) ?? 0;
      return times === 0 ? preferred : `${preferred}_${times + 1}`;
    };

    for (;;) {
      const rewrite = (node: unknown) =>
        rewriteRefs(node, (ref) =>
          componentRef(
            ref,
            finalName,
            refersToRoot ? finalName(rootKey) : null,
          ),
        );
      const placed = new Map<string, JsonSchema>(
        names.map((name) => [
          finalName(name),
          rewrite(definitions[name]) as JsonSchema,
        ]),
      );
      if (refersToRoot)
        placed.set(finalName(rootKey), rewrite(root) as JsonSchema);

      const clash = [...names, ...(refersToRoot ? [rootKey] : [])].find(
        (name) => {
          const existing = this.schemas[finalName(name)];
          return (
            existing !== undefined &&
            !sameSchema(existing, placed.get(finalName(name)))
          );
        },
      );
      if (clash !== undefined) {
        if (clash !== rootKey && !ZOD_GENERATED_NAME.test(clash)) {
          throw new Error(
            `Schema id '${clash}' already exists with a different schema`,
          );
        }
        taken.set(clash, (taken.get(clash) ?? 0) + 1);
        continue;
      }

      for (const [name, placedSchema] of placed)
        this.schemas[name] = placedSchema;
      const embedded = refersToRoot
        ? { $ref: COMPONENTS_POINTER + finalName(rootKey) }
        : rewrite(root);
      return PARAMETER_TYPES.has(place.type)
        ? this.inlined(embedded as JsonSchema)
        : (embedded as JsonSchema);
    }
  }

  /** A schema that is only a ref to a component, as that component. */
  private inlined(schema: JsonSchema): JsonSchema {
    const ref = schema.$ref;
    if (
      Object.keys(schema).length !== 1 ||
      typeof ref !== "string" ||
      !ref.startsWith(COMPONENTS_POINTER)
    ) {
      return schema;
    }
    return this.schemas[ref.slice(COMPONENTS_POINTER.length)] ?? schema;
  }

  /** Adds these schemas to a document's components; a different schema under a taken name throws. */
  addTo(document: Record<string, unknown>): void {
    if (Object.keys(this.schemas).length === 0) return;
    const components = isObject(document.components) ? document.components : {};
    const existing = isObject(components.schemas) ? components.schemas : {};
    for (const [name, schema] of Object.entries(this.schemas)) {
      if (name in existing && !sameSchema(existing[name], schema)) {
        throw new Error(
          `Schema '${name}' already exists with a different schema`,
        );
      }
    }
    document.components = {
      ...components,
      schemas: { ...existing, ...this.schemas },
    };
  }
}

/**
 * Where a local ref points once the definitions are components: a definition
 * by its component name, the schema's root (`#`, `#/properties/...`) at its
 * component when it has one. Anchors, other documents and refs already into
 * the components are kept.
 */
function componentRef(
  ref: string,
  finalName: (name: string) => string,
  rootName: string | null,
): string {
  for (const keyword of DEFINITIONS_KEYWORDS) {
    const prefix = `#/${keyword}/`;
    if (ref.startsWith(prefix)) {
      const [name, ...rest] = ref.slice(prefix.length).split("/");
      return [COMPONENTS_POINTER + finalName(name!), ...rest].join("/");
    }
  }
  if (rootName !== null && isRootPointer(ref)) {
    return COMPONENTS_POINTER + rootName + ref.slice(1);
  }
  return ref;
}

/** Keywords whose value is a subschema or an array of subschemas. */
const SUBSCHEMA_KEYWORDS = new Set([
  "items",
  "additionalItems",
  "prefixItems",
  "contains",
  "additionalProperties",
  "propertyNames",
  "unevaluatedItems",
  "unevaluatedProperties",
  "not",
  "if",
  "then",
  "else",
  "allOf",
  "anyOf",
  "oneOf",
]);

/** Keywords whose value maps names to subschemas. */
const SUBSCHEMA_MAP_KEYWORDS = new Set([
  "properties",
  "patternProperties",
  "dependentSchemas",
  "definitions",
  "$defs",
]);

/**
 * A copy of a schema with `rewrite` applied to every `$ref` in it and its
 * subschemas. Property names and literal values (const, enum, default,
 * examples) are left alone.
 */
function rewriteRefs(node: unknown, rewrite: (ref: string) => string): unknown {
  if (!isObject(node)) return node;
  const result: JsonSchema = {};
  for (const [keyword, value] of Object.entries(node)) {
    if (keyword === "$ref" && typeof value === "string") {
      result[keyword] = rewrite(value);
    } else if (SUBSCHEMA_KEYWORDS.has(keyword)) {
      result[keyword] = Array.isArray(value)
        ? value.map((child) => rewriteRefs(child, rewrite))
        : rewriteRefs(value, rewrite);
    } else if (SUBSCHEMA_MAP_KEYWORDS.has(keyword) && isObject(value)) {
      result[keyword] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [
          name,
          rewriteRefs(child, rewrite),
        ]),
      );
    } else {
      result[keyword] = value;
    }
  }
  return result;
}

/** Whether a schema refers to its own root (`#`, `#/properties/...`), outside its definitions. */
function hasRootRef(node: unknown): boolean {
  let found = false;
  rewriteRefs(node, (ref) => {
    if (isRootPointer(ref)) found = true;
    return ref;
  });
  return found;
}

/** A JSON pointer into the schema itself, not into its definitions or the components. */
function isRootPointer(ref: string): boolean {
  const intoDefinitions = DEFINITIONS_KEYWORDS.some((keyword) =>
    ref.startsWith(`#/${keyword}/`),
  );
  return (
    (ref === "#" || ref.startsWith("#/")) &&
    !intoDefinitions &&
    !ref.startsWith(COMPONENTS_POINTER)
  );
}

function sameSchema(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
