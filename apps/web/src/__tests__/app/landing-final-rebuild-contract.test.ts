import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("landing final rebuild narrative", () => {
  it("restores the timeline scene between the promise and the product example", () => {
    const page = source("app/landing/landing-page.tsx");
    const heroIndex = page.indexOf("<DetectionScene");
    const workspaceIndex = page.indexOf("<WorkspaceScene");
    const proofIndex = page.indexOf("<EvidenceScene");

    expect(heroIndex).toBeGreaterThan(-1);
    expect(workspaceIndex).toBeGreaterThan(heroIndex);
    expect(proofIndex).toBeGreaterThan(workspaceIndex);
    const timelineIndex = page.indexOf("<SignalTimeline />");
    expect(timelineIndex).toBeGreaterThan(heroIndex);
    expect(timelineIndex).toBeLessThan(workspaceIndex);
    expect(page).not.toContain("<RadarScene");
  });

  it("keeps the restored ambient hero payment-aware and connected to the preview", () => {
    const hero = source("app/landing/detection-scene.tsx");

    expect(hero).toContain('data-hero-layout="ambient-radar"');
    expect(hero).toContain('data-theme="inverse"');
    expect(hero).toContain("data-payment-offer=");
    expect(hero).toContain("Посмотреть пример");
    expect(hero).toContain("data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}");
    expect(hero).toContain("data-hero-trust-line");
    expect(hero).toContain("без автопродления · сообщения отправляете вы");
    expect(hero).not.toContain("HeroRadar");
    expect(hero).not.toContain("HIGH");
  });

  it("uses one canonical default company story across hero, preview, and proof", () => {
    const copy = source("app/landing/landing-copy.ts");
    const preview = source("lib/publicProduct.ts");

    expect(copy).toContain('from "../../lib/landing-demo"');
    expect(preview).toContain('from "./landing-demo"');
    expect(copy).toContain("DEFAULT_LANDING_DEMO_STORY.company");
    expect(copy).toContain("opener: DEFAULT_LANDING_DEMO_STORY.company.opener");
    expect(preview).toContain("DEFAULT_LANDING_DEMO_STORY.company");
    expect(copy).not.toContain('name: "Промышленная группа"');
  });

  it("lets proof own the complete evidence chain and a stronger conclusion", () => {
    const proof = source("app/landing/evidence-scene.tsx");
    const proofCss = source("app/landing/evidence-scene.module.css");

    expect(proof).toContain('data-proof-story="why-now"');
    expect(proof).toContain("data-proof-event");
    expect(proof).toContain("data-proof-brief");
    expect(proof).toContain("DEMO_EVIDENCE_SOURCES.map");
    expect(proof).toContain("Уверенность");
    expect(proof).toContain("Следующий ход");
    expect(proof).not.toContain("HIGH CONFIDENCE");
    expect(proofCss).toContain(".evidenceChain");
    expect(proofCss).toContain(".resolution");
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
    expect(workspace).toContain("Интерактивный пример");
    expect(workspace).toContain("Обезличенный пример.");
    expect(workspace).toContain("props.previewState.isPersonalized && appliedProfile.length > 0");
    expect(workspace).toContain("<WorkspaceLeadList");
    expect(lead).toContain("limit: 2");
    expect(lead).toContain("Уверенность");
    expect(lead).toContain("Следующий ход");
    expect(lead).not.toContain("Confidence</span>");
    expect(leadList).toContain("const defaultVisible = mobileEnhanced ? 3 : 4");
    expect(leadList).toContain("Показать ещё");
    expect(workspaceCss).not.toContain("-webkit-line-clamp");
    expect(workspace).not.toContain("RECRUITER RADAR</strong>");
  });

  it("keeps delivery compact while preserving every truthful runtime channel", () => {
    const delivery = source("app/landing/delivery-scene.tsx");
    const deliveryCss = source("app/landing/delivery-scene.module.css");

    expect(delivery).toContain('data-delivery-summary="compact"');
    expect(delivery).toContain("Радар находит повод. Пишете вы.");
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

  it("makes the pilot the only dominant offer and keeps the final CTA compact", () => {
    const conversion = source("app/landing/conversion-panel.tsx");
    const conversionCss = source("app/landing/conversion-panel.module.css");

    expect(conversion).toContain('data-pilot-entry="primary"');
    expect(conversion).toContain('data-pricing-layout="pilot-decision"');
    expect(conversion).toContain('data-faq-layout="centered"');
    expect(conversion).not.toContain("data-recommended={plan.isPrimary");
    expect(conversion).not.toContain("TargetIcon");
    expect(conversionCss).toContain("min-height: 21rem");
    expect(conversionCss).not.toContain("min-height: 26rem");
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
