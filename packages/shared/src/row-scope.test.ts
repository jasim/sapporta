import { describe, expect, it } from "vitest";
import {
  isSystemManagedScopeFieldName,
  systemManagedScopeFieldNames,
} from "./row-scope.js";

describe("system-managed row-scope fields", () => {
  it("recognizes the SQL and TypeScript ownership field names", () => {
    const names = [
      "workspace_id",
      "workspaceId",
      "scoped_to_user_id",
      "scopedToUserId",
    ];

    expect(systemManagedScopeFieldNames()).toEqual(names);
    for (const name of names) {
      expect(isSystemManagedScopeFieldName(name)).toBe(true);
    }
    expect(isSystemManagedScopeFieldName("owner_id")).toBe(false);
  });
});
