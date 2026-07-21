import { describe, expect, it } from "vitest";
import { ApiError } from "@sapporta/shared/error";
import {
  FormSubmissionError,
  fieldIssuesForSubmissionError,
  firstFormErrorMessage,
} from "./submission-errors";

describe("FormSubmissionError", () => {
  it("preserves field issues and builds a useful Error message", () => {
    const issues = [{ field: "title", message: "Title is required." }];
    const error = new FormSubmissionError(issues);
    issues[0] = { field: "other", message: "Changed" };

    expect(error.name).toBe("FormSubmissionError");
    expect(error.message).toBe("title: Title is required.");
    expect(error.issues).toEqual([
      { field: "title", message: "Title is required." },
    ]);
  });
});

describe("fieldIssuesForSubmissionError", () => {
  it("reads local and Sapporta API submission issues", () => {
    const local = new FormSubmissionError([
      { field: "title", message: "Title is required." },
    ]);
    expect(fieldIssuesForSubmissionError(local)).toEqual(local.issues);

    const api = new ApiError(422, {
      error: "Validation failed",
      details: [
        { field: "project_id", message: "Project is not visible." },
        { path: ["lines", 0, "quantity"], message: "Required" },
      ],
    });
    expect(fieldIssuesForSubmissionError(api)).toEqual([
      { field: "project_id", message: "Project is not visible." },
      { field: "lines.0.quantity", message: "Required" },
    ]);
    expect(fieldIssuesForSubmissionError(new Error("Failed"))).toEqual([]);
  });
});

describe("firstFormErrorMessage", () => {
  it("normalizes TanStack Form field error values", () => {
    expect(firstFormErrorMessage([])).toBeUndefined();
    expect(firstFormErrorMessage(["Required"])).toBe("Required");
    expect(firstFormErrorMessage([new Error("Invalid")])).toBe("Invalid");
    expect(firstFormErrorMessage([{ message: "Try again" }])).toBe("Try again");
    expect(firstFormErrorMessage([42])).toBe("42");
  });
});
