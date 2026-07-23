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
const layoutSource = readFileSync(
  resolve(process.cwd(), "app", "layout.tsx"),
  "utf8",
);
const landingStyles = readFileSync(
  resolve(process.cwd(), "app", "home-page-components.module.css"),
  "utf8",
);

describe("page primitive CSS module contract", () => {
  it("keeps document tokens in the global stylesheet instead of duplicating them in a CSS module", () => {
    expect(globalStyles).toContain(":root {");
    expect(globalStyles).toContain("--c-brand: #1d4ed8;");
    expect(globalStyles).toContain("--fs-display: clamp(2.2rem, 4.8vw, 3.7rem);");
    expect(primitiveStyles).not.toMatch(/(^|\n)\s*:root\s*\{/);
    expect(primitiveStyles).not.toContain(":global(:root)");
  });

  it("gives the landing a dedicated editorial display face and readable type rhythm", () => {
    expect(layoutSource).toContain("Manrope");
    expect(layoutSource).toContain('variable: "--font-manrope"');
    expect(globalStyles).toContain("--font-display: var(--font-manrope");
    expect(landingStyles).toMatch(/\.heroTitle\s*\{[\s\S]*font-family:\s*var\(--font-display\)/);
    expect(primitiveStyles).toMatch(/\.sectionEyebrowAccent\s*\+\s*\.sectionTitle\s*\{[\s\S]*font-family:\s*var\(--font-display\)/);
  });
});
