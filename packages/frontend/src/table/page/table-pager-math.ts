import { parseOptionalBoundedInteger } from "@sapporta/shared/validation";

export function clampPage(page: number, pages: number): number {
  if (pages <= 0) return 1;
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), pages);
}

export function parsePageJump(raw: string, pages: number): number | undefined {
  try {
    return parseOptionalBoundedInteger(raw, {
      name: "page",
      min: 1,
      max: pages,
      makeError: (message) => new Error(message),
    });
  } catch {
    return undefined;
  }
}
