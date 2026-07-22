import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const primitiveStyles = readFileSync(
  resolve(process.cwd(), "app", "ui", "page-primitives.module.css"),
  "utf8",
);
const globalStyles = readFileSync(
  resolve(process.cwd(), "app", "globals.css"),
  "utf8",
);

describe("page primitive CSS module contract", () => {
  it("keeps document tokens in the global stylesheet instead of duplicating them in a CSS module", () => {
    expect(globalStyles).toContain(":root {");
    expect(globalStyles).toContain("--c-brand: #1d4ed8;");
    expect(globalStyles).toContain("--fs-display: clamp(2.1rem, 4.6vw, 3.5rem);");
    expect(primitiveStyles).not.toMatch(/(^|\n)\s*:root\s*\{/);
    expect(primitiveStyles).not.toContain(":global(:root)");
  });
});
