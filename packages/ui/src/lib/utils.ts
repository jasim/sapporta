import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Convert a display header like "Customer Name" → "customer_name" */
export function slugifyColumnName(input: string): string {
  let slug = input
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  // Must start with a letter (server validates /^[a-z][a-z0-9_]*$/)
  if (/^[0-9]/.test(slug)) slug = "col_" + slug;
  return slug;
}
