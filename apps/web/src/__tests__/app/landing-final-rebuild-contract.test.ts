import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("landing final rebuild narrative", () => {
  it("moves the real product example directly after the promise", () => {
    const page = source("app/landing/landing-page.tsx");
    const heroIndex = page.indexOf("<DetectionScene");
    const workspaceIndex = page.indexOf("<WorkspaceScene");
    const proofIndex = page.indexOf("<EvidenceScene");

    expect(heroIndex).toBeGreaterThan(-1);
    expect(workspaceIndex).toBeGreaterThan(heroIndex);
    expect(proofIndex).toBeGreaterThan(workspaceIndex);
    expect(page.slice(heroIndex, workspaceIndex)).not.toContain("<SignalTimelineScene");
    expect(page).not.toContain("<RadarScene");
  });

  it("uses an evidence-first decision object instead of the old table grammar", () => {
    const hero = source("app/landing/detection-scene.tsx");
    const heroCss = source("app/landing/detection-scene.module.css");

    expect(hero).toContain('data-hero-layout="company-brief"');
    expect(hero).toContain('data-art-direction="evidence-first"');
    expect(hero).toContain('data-hero-company-brief="true"');
    expect(hero).toContain("Почему сейчас");
    expect(hero).toContain("Подтверждения");
    expect(hero).toContain("Уровень подтверждения");
    expect(hero).toContain("Следующий ход");
    expect(hero).toContain("Проверяемые факты · официальный контакт · без авторассылки");
    expect(hero).not.toContain('data-hero-layout="signal-spine"');
    expect(heroCss).toContain(".resolutionChain");
    expect(heroCss).not.toContain(".briefHeader");
    expect(heroCss).not.toContain(".evidenceBlock li + li");
  });

  it("uses one canonical default company story across hero, preview, and proof", () => {
    const copy = source("app/landing/landing-copy.ts");
    const preview = source("lib/publicProduct.ts");

    expect(copy).toContain('from "../../lib/landing-demo"');
    expect(preview).toContain('from "./landing-demo"');
    expect(copy).toContain("DEFAULT_LANDING_DEMO_STORY.company");
    expect(preview).toContain("DEFAULT_LANDING_DEMO_STORY.company");
    expect(copy).not.toContain('name: "Промышленная группа"');
  });

  it("consolidates time, evidence, confidence, and next move into one proof chain", () => {
    const proof = source("app/landing/evidence-scene.tsx");
    const proofCss = source("app/landing/evidence-scene.module.css");

    expect(proof).toContain('data-proof-story="why-now"');
    expect(proof).toContain("data-proof-event");
    expect(proof).toContain("data-proof-brief");
    expect(proof).toContain("Уровень подтверждения");
    expect(proof).toContain("Следующий ход");
    expect(proofCss).toContain(".evidenceChain");
    expect(proofCss).not.toContain(".proofObject");
  });

  it("presents the preview as a compact marketing product outcome", () => {
    const workspace = source("app/landing/workspace-scene.tsx");
    const lead = source("app/landing/workspace-lead.tsx");
    const leadList = source("app/landing/workspace-lead-list.tsx");
    const workspaceCss = source("app/landing/workspace-scene.module.css");

    expect(workspace).toContain('data-preview-editorial="true"');
    expect(workspace).toContain('data-preview-layout="marketing-demo"');
    expect(workspace).toContain("Проверьте на своей нише");
    expect(workspace).toContain("Настройте профиль — выдача обновится.");
    expect(workspace).toContain("<WorkspaceLeadList>");
    expect(lead).toContain("limit: 2");
    expect(leadList).toContain("const defaultVisible = mobileEnhanced ? 3 : 4");
    expect(leadList).toContain("Показать ещё");
    expect(workspaceCss).not.toContain("-webkit-line-clamp");
    expect(workspace).not.toContain("RECRUITER RADAR</strong>");
  });

  it("keeps delivery compact while preserving every truthful runtime channel", () => {
    const delivery = source("app/landing/delivery-scene.tsx");
    const deliveryCss = source("app/landing/delivery-scene.module.css");

    expect(delivery).toContain('data-delivery-summary="compact"');
    expect(delivery).toContain("Веб-кабинет");
    expect(delivery).toContain("Telegram");
    expect(delivery).toContain("Email");
    expect(delivery).toContain("VK");
    expect(delivery).toContain("Push в браузере");
    expect(delivery).toContain("Webhook");
    expect(delivery).toContain("Сообщения компаниям не отправляются автоматически");
    expect(deliveryCss).toContain(".capabilityBand");
    expect(delivery).not.toContain("outreachDraft");
    expect(delivery).not.toContain("ПРИМЕР СООБЩЕНИЯ");
  });

  it("makes the pilot the only dominant offer and centers FAQ", () => {
    const conversion = source("app/landing/conversion-panel.tsx");
    const conversionCss = source("app/landing/conversion-panel.module.css");

    expect(conversion).toContain('data-pilot-entry="primary"');
    expect(conversion).toContain('data-pricing-layout="pilot-decision"');
    expect(conversion).toContain('data-faq-layout="centered"');
    expect(conversion).not.toContain("data-recommended={plan.isPrimary");
    expect(conversion).not.toContain("TargetIcon");
    expect(conversionCss).toContain("min-height: 26rem");
  });

  it("removes the shared giant-section composition layer", () => {
    const landing = source("app/landing/landing.module.css");
    const visual = source("app/landing/landing-visual-system.module.css");

    expect(landing).not.toContain("--display:");
    expect(landing).not.toContain("--title:");
    expect(landing).not.toMatch(/\.sceneHeading\s*\{[^}]*font-size/);
    expect(visual).not.toContain(":global(#pricing [data-pricing-intro] h2)");
    expect(visual).not.toContain(":global(#faq [data-faq-heading] h2)");
  });
});
