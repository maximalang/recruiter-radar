import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");
const REPO_ROOT = resolve(WEB_ROOT, "../..");

function source(path: string) {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

function repoSource(path: string) {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

describe("landing sales production pass", () => {
  it("locks the lower one-off public pricing ladder", () => {
    const pricing = source("lib/pricingCatalog.ts");
    expect(pricing).toContain('price: "990 ₽"');
    expect(pricing).toContain("amountMinor: 99000");
    expect(pricing).toContain('price: "2 990 ₽"');
    expect(pricing).toContain("amountMinor: 299000");
    expect(pricing).toContain('price: "6 990 ₽"');
    expect(pricing).toContain("amountMinor: 699000");
    expect(pricing.match(/isPrimary: true/g)).toHaveLength(1);
    expect(pricing.match(/isRecurring: false/g)).toHaveLength(4);
  });

  it("keeps the merchant runbook on the same public prices", () => {
    const runbook = repoSource("docs/robokassa-production-checklist.md");
    expect(runbook).toContain("| Неделя | 7 дней | 990 ₽ | Нет |");
    expect(runbook).toContain("| Месяц | 30 дней | 2 990 ₽ | Нет |");
    expect(runbook).toContain("| Квартал | 90 дней | 6 990 ₽ | Нет |");
    expect(runbook).not.toContain("| Неделя | 7 дней | 2 990 ₽ | Нет |");
    expect(runbook).not.toContain("| Месяц | 30 дней | 9 990 ₽ | Нет |");
  });

  it("focuses the preview on the top-ranked visible lead and discloses the rest", () => {
    const workspace = source("app/landing/workspace-scene.tsx");
    const list = source("app/landing/workspace-lead-list.tsx");
    expect(workspace).toContain("const visibleItems = previewState.items.slice(0, 5)");
    expect(workspace).toContain("defaultOpen={index === 0}");
    expect(list).toContain("const defaultVisible = mobileEnhanced ? 3 : 4");
    expect(list).toContain("Показать ещё");
  });

  it("keeps the pricing hierarchy and closing trust points concise", () => {
    const panel = source("app/landing/conversion-panel.tsx");
    expect(panel).toContain('data-pilot-entry="primary"');
    expect(panel).toContain('data-pricing-layout="pilot-decision"');
    expect(panel).not.toContain("data-recommended={plan.isPrimary");
    expect(panel).toContain("Без автопродления");
    expect(panel).toContain("Факты и источники по каждой компании");
    expect(panel).toContain("Сообщения отправляете вы");
  });

  it("uses lightweight reveal motion with a reduced-motion fallback", () => {
    const motion = source("app/landing/landing-motion.tsx");
    const motionCss = source("app/landing/landing-motion.module.css");
    expect(motion).toContain("IntersectionObserver");
    expect(motion).toContain("prefers-reduced-motion: reduce");
    expect(motionCss).toMatch(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/);
    expect(motionCss).not.toMatch(/filter:\s*blur/i);
  });
});
