import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { comboboxClassNames } from "./combobox";

/**
 * Compiles the shared class strings and checks what they actually resolve to.
 * A class that produces no utility, or one the browser discards, still sits in
 * the markup and leaves the element in the accessibility tree, so only the
 * compiled CSS shows the difference.
 */

const UI_PACKAGE_ROOT = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const UI_INDEX_CSS = join(UI_PACKAGE_ROOT, "src/index.css");

const requireFromUiPackage = createRequire(
  join(UI_PACKAGE_ROOT, "package.json"),
);

/** Every class string these objects hold ends up on a rendered element. */
const CLASS_NAME_SETS: Record<string, string>[] = [comboboxClassNames];

function allClassNames(): string[] {
  const classNames = new Set<string>();
  for (const styles of CLASS_NAME_SETS) {
    for (const value of Object.values(styles)) {
      for (const className of value.split(/\s+/)) {
        if (className !== "") classNames.add(className);
      }
    }
  }
  return [...classNames];
}

/**
 * Compile through the same pipeline a generated app runs: Tailwind's own CSS
 * plus this package's tokens, with the candidates supplied directly so the
 * test never touches the filesystem scanner.
 */
async function buildCss(candidates: string[]): Promise<string> {
  const compiler = await compile(
    `@import "tailwindcss";\n@import "${UI_INDEX_CSS}";\n`,
    {
      base: dirname(UI_INDEX_CSS),
      async loadStylesheet(id: string, base: string) {
        const path = id.startsWith(".")
          ? resolvePath(base, id)
          : requireFromUiPackage.resolve(
              id.endsWith(".css") ? id : `${id}/index.css`,
            );
        return {
          path,
          base: dirname(path),
          content: readFileSync(path, "utf8"),
        };
      },
    },
  );
  return compiler.build(candidates);
}

/** Read one declaration out of the rule generated for a single class. */
function declarationFor(css: string, className: string, property: string) {
  // Tailwind escapes non-identifier characters in the selector it emits, so
  // `w-(--anchor-width)` becomes `.w-\(--anchor-width\)`.
  const selector = `.${className.replace(/[^\w-]/g, (char) => `\\${char}`)}`;
  const ruleStart = css.indexOf(`${selector} {`);
  if (ruleStart === -1) return null;
  const body = css.slice(ruleStart, css.indexOf("}", ruleStart));
  const match = new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;]+)`).exec(body);
  return match === null ? null : match[1].trim();
}

describe("shared Tailwind class strings", () => {
  it("never emits a bare custom property as a declaration value", async () => {
    const css = await buildCss(allClassNames());
    // Tailwind v3 wrote custom properties as `w-[--anchor-width]`; v4 reads
    // the brackets as a literal and emits `width: --anchor-width`, which every
    // browser drops. The v4 form is `w-(--anchor-width)`.
    const bareVariableValues = [
      ...css.matchAll(/(?:^|[;{])\s*(?!--)([a-z-]+):\s*(--[\w-]+)\s*(?=[;}])/g),
    ].map((match) => `${match[1]}: ${match[2]}`);
    expect(bareVariableValues).toEqual([]);
  });

  it("resolves the combobox popup to an anchor-matched, opaque panel", async () => {
    const css = await buildCss(comboboxClassNames.popup.split(/\s+/));

    expect(declarationFor(css, "w-(--anchor-width)", "width")).toBe(
      "var(--anchor-width)",
    );
    expect(declarationFor(css, "bg-popover", "background-color")).toBe(
      "var(--popover)",
    );
    expect(declarationFor(css, "text-popover-foreground", "color")).toBe(
      "var(--popover-foreground)",
    );
    // The tokens those utilities point at must exist, or the panel renders
    // transparent even though the utilities were generated.
    expect(css).toMatch(/--popover:\s*[^;]+;/);
    expect(css).toMatch(/--popover-foreground:\s*[^;]+;/);
  });
});
