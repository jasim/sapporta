import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The names an app adds to Tailwind's theme scales through `@theme`, beyond
 * the stock ones. `cn` needs them to tell `text-body` (a size) from
 * `text-sap-fg` (a colour), and `h-sap-ctl` from any other height. Without
 * the registration, tailwind-merge reads every unknown `text-*` as a colour
 * and drops whichever of the two came first.
 */
export interface ClassMergeScales {
  /** Font sizes: the `name` in `--text-name`, used as `text-name`. */
  text?: readonly string[];
  /** Letter spacing: the `name` in `--tracking-name`, used as `tracking-name`. */
  tracking?: readonly string[];
  /**
   * Lengths: the `name` in `--height-name` or `--spacing-name`, used as
   * `h-name`, `min-h-name`, `w-name`, `p-name`, and so on.
   */
  spacing?: readonly string[];
}

/** The scales `@sapporta/ui/index.css` registers. */
const SAPPORTA_SCALES: Required<ClassMergeScales> = {
  text: [
    "sap-tiny",
    "sap-micro",
    "sap-label",
    "sap-meta",
    "sap-menu",
    "sap-data",
    "sap-emph",
    "sap-body",
    "sap-mark",
    "sap-display",
  ],
  tracking: ["sap-display", "sap-head", "sap-label", "sap-section"],
  spacing: ["sap-row", "sap-header", "sap-ctl", "sap-bar", "sap-topbar"],
};

let scales: Required<ClassMergeScales> = SAPPORTA_SCALES;
let merge = createMerge(scales);

function createMerge(known: Required<ClassMergeScales>) {
  return extendTailwindMerge({
    extend: {
      theme: {
        text: [...known.text],
        tracking: [...known.tracking],
        spacing: [...known.spacing],
      },
    },
  });
}

/**
 * Joins class names and resolves Tailwind conflicts, the later class winning.
 * It knows Sapporta's own `text-sap-*`, `tracking-sap-*` and `h-sap-*`
 * scales; an app registers its own with `extendCn`.
 */
export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}

/**
 * Registers an app's own theme scales with `cn`, so its custom sizes merge
 * correctly everywhere, including inside Sapporta's components. Call it once
 * at startup, before anything renders:
 *
 *     extendCn({ text: ["display", "title", "body"], spacing: ["control"] });
 */
export function extendCn(extra: ClassMergeScales): void {
  scales = {
    text: [...scales.text, ...(extra.text ?? [])],
    tracking: [...scales.tracking, ...(extra.tracking ?? [])],
    spacing: [...scales.spacing, ...(extra.spacing ?? [])],
  };
  merge = createMerge(scales);
}
