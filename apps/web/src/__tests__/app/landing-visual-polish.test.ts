import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string) {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("polished unified landing visual contract", () => {
  it("keeps the hero radar centerless and free of a connecting beam", () => {
    const hero = source("app/landing/hero-instrument.tsx");
    const compatibilityRadar = source("app/landing/brand-glyphs.tsx");

    expect(hero).not.toContain("instrumentConnection");
    expect(hero).not.toContain("instrumentCore");
    expect(hero).not.toContain("instrument-link");
    expect(hero).not.toContain("temporary signal field");
    expect(hero).toContain("Подтверждённый сигнал / текущий приоритет");
    expect(compatibilityRadar).not.toContain("styles.instrumentCore");
  });

  it("uses one stable preview anchor without duplicating it in the suspense fallback", () => {
    const workspace = source("app/landing/workspace-scene.tsx");
    const skeletonStart = workspace.indexOf("export function WorkspaceResultsSkeleton");
    const skeletonSource = workspace.slice(skeletonStart);

    expect(workspace).toContain('id="preview-results"');
    expect(workspace).toContain("<Suspense fallback={<WorkspaceResultsSkeleton />}>");
    expect(workspace).toContain("embedded");
    expect(skeletonSource).not.toContain('id="preview-results"');
    expect(skeletonSource).toContain("data-preview-results-skeleton");
  });

  it("switches header tone at the actual pricing, faq, and closing surfaces", () => {
    const conversion = source("app/landing/conversion-panel.tsx");

    expect(conversion).not.toContain('aria-label="Тарифы и ответы" data-header-tone="dark"');
    expect(conversion).toMatch(/id="pricing"[\s\S]*?data-header-tone="light"/);
    expect(conversion).toMatch(/id="faq"[\s\S]*?data-header-tone="light"/);
    expect(conversion).toMatch(/id="conversion-final"[\s\S]*?data-header-tone="dark"/);
  });

  it("preserves the Robokassa-ready public footer while using the canonical offer route", () => {
    const footer = source("app/ui/site-footer.tsx");

    expect(footer).toContain('href="/offer"');
    expect(footer).toContain('href="/payment-and-refund"');
    expect(footer).toContain("OPERATOR_REQUISITES.phone");
    expect(footer).toContain("OPERATOR_REQUISITES.city");
    expect(footer).toContain('href="/admin/payments"');
  });
});
