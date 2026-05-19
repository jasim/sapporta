import { z } from "zod";
import type { ValueKind } from "../value-kind.js";

/**
 * Zod twin of `ValueKind` from `../value-kind.ts`. Kept here, in the
 * contracts dir, so the runtime schema and the wire types co-locate
 * without dragging the contract layer back into the operator-matrix
 * module that owns the canonical TS type.
 */
export const valueKindSchema = z.enum([
  "text",
  "number",
  "boolean",
  "date",
  "timestamp",
]) satisfies z.ZodType<ValueKind>;
