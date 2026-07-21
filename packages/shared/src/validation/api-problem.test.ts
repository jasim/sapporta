import { describe, expect, it } from "vitest";
import { apiProblemFromBody } from "./api-problem";

describe("apiProblemFromBody", () => {
  it("normalizes Sapporta field details and Zod issue details", () => {
    expect(
      apiProblemFromBody({
        error: "Validation failed",
        code: "VALIDATION_FAILED",
        details: [
          { field: "title", message: "Title is required." },
          {
            code: "too_small",
            path: ["lines", 0, "quantity"],
            message: "Quantity must be positive.",
          },
          { field: 42, message: "Ignored" },
        ],
      }),
    ).toEqual({
      summary: "Validation failed",
      code: "VALIDATION_FAILED",
      fieldIssues: [
        { field: "title", message: "Title is required." },
        {
          field: "lines.0.quantity",
          message: "Quantity must be positive.",
        },
      ],
    });
  });

  it("rejects values that are not Sapporta error bodies", () => {
    expect(apiProblemFromBody({ message: "Request failed" })).toBeUndefined();
    expect(apiProblemFromBody("Request failed")).toBeUndefined();
  });
});
