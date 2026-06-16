export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
] as const;

export function parseJsonObject(content: string, path: string): JsonObject {
  const parsed: unknown = JSON.parse(content);
  if (!isJsonObject(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return parsed;
}

export function mergePackageJson(
  existing: JsonObject,
  scaffold: JsonObject,
): JsonObject {
  const merged: JsonObject = { ...existing };

  for (const [key, value] of Object.entries(scaffold)) {
    if (key === "name" || key === "scripts" || isDependencyField(key)) {
      continue;
    }
    if (!(key in merged)) {
      merged[key] = value;
    } else if (key === "pnpm") {
      merged[key] = mergeNestedObject(merged[key], value);
    }
  }

  for (const field of DEPENDENCY_FIELDS) {
    const existingDeps = getStringRecord(existing[field]);
    const scaffoldDeps = getStringRecord(scaffold[field]);
    if (
      Object.keys(scaffoldDeps).length > 0 ||
      Object.keys(existingDeps).length > 0
    ) {
      merged[field] = { ...existingDeps, ...scaffoldDeps };
    }
  }

  return merged;
}

function mergeNestedObject(
  existing: JsonValue,
  scaffold: JsonValue,
): JsonValue {
  if (!isJsonObject(existing) || !isJsonObject(scaffold)) {
    return existing;
  }
  const merged: JsonObject = { ...existing };
  for (const [key, value] of Object.entries(scaffold)) {
    const existingValue = merged[key];
    merged[key] =
      isJsonObject(existingValue) && isJsonObject(value)
        ? mergeNestedObject(existingValue, value)
        : key in merged
          ? existingValue
          : value;
  }
  return merged;
}

function isDependencyField(
  key: string,
): key is (typeof DEPENDENCY_FIELDS)[number] {
  return DEPENDENCY_FIELDS.some((field) => field === key);
}

function getStringRecord(value: JsonValue | undefined): Record<string, string> {
  if (!isJsonObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
