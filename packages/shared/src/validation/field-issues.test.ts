import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fieldIssuesFromZodError } from "./field-issues";

describe("fieldIssuesFromZodError", () => {
  it("preserves nested paths and maps form-level issues", () => {
    const schema = z
      .object({
        lines: z.array(
          z.object({
            quantity: z.number().positive("Quantity must be positive."),
          }),
        ),
      })
      .refine(() => false, "The submission is invalid.");
    const result = schema.safeParse({ lines: [{ quantity: 0 }] });
    if (result.success) throw new Error("Expected validation to fail.");

    expect(fieldIssuesFromZodError(result.error)).toEqual([
      {
        field: "lines.0.quantity",
        message: "Quantity must be positive.",
      },
      { field: "form", message: "The submission is invalid." },
    ]);
  });
});
