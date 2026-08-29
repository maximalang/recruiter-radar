import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

/* Restoration narrative contracts (PR #227):
 * the pre-218 dark ambient identity is restored on top of the canonical
 * token/motion/accessibility system. These tests encode the restored
 * product story — Preview as one coherent Recruiter Radar object,
 * Evidence as a research ledger, Delivery around the manual outreach
 * boundary, Final as a dark radar echo — instead of the rejected #225
 * composition geometry. */

describe("landing restoration narrative", () => {
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

    expect(hero).toContain('data-hero-layout="product-workspace"');
    expect(hero).toContain('data-theme="inverse"');
    expect(hero).toContain("data-payment-offer=");
    expect(hero).toContain("Посмотреть пример для своей ниши");
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

  it("presents the preview as one coherent Recruiter Radar product object", () => {
    const workspace = source("app/landing/workspace-scene.tsx");
    const lead = source("app/landing/workspace-lead.tsx");
    const leadList = source("app/landing/workspace-lead-list.tsx");
    const workspaceCss = source("app/landing/workspace-scene.module.css");

    // One product frame with a visible identity rail — not a generic
    // SaaS form/table grid.
    expect(workspace).toContain('data-product-preview="live-radar"');
    expect(workspace).toContain('data-preview-editorial="true"');
    expect(workspace).toContain("data-preview-rail");
    expect(workspace).toContain("<span>Recruiter Radar</span>");
    expect(workspace).toContain("ПРИМЕР");

    // Editorial intro stays bound to the live configurator.
    expect(workspace).toContain("Интерактивный пример");
    expect(workspace).toContain("Настройте практику");
    expect(workspace).toContain("Проверьте, какие компании попадут в ваш рабочий список.");
    expect(workspace).toContain("Обезличенный пример.");

    // Current runtime behavior preserved: personalization, ranked leads,
    // progressive disclosure, unclamped prose.
    expect(workspace).toContain("props.previewState.isPersonalized && appliedProfile.length > 0");
    expect(workspace).toContain("<WorkspaceLeadList");
    expect(lead).toContain("limit: 2");
    expect(lead).toContain("Уверенность");
    expect(lead).toContain("Следующий ход");
    expect(leadList).toContain("const defaultVisible = mobileEnhanced ? 2 : 4");
    expect(leadList).toContain("Показать ещё");
    expect(workspaceCss).not.toContain("-webkit-line-clamp");
  });

  it("tells the delivery story around the manual outreach boundary with truthful channels", () => {
    const delivery = source("app/landing/delivery-scene.tsx");
    const deliveryCss = source("app/landing/delivery-scene.module.css");

    // Narrative headline: the radar finds the reason, the human writes.
    expect(delivery).toContain("Радар находит повод. Пишете вы.");

    // Truthful channel hierarchy: web cabinet is the core surface,
    // connected notification routes come next, secondary routes are
    // disclosed on demand instead of six equal cards.
    expect(delivery).toContain('data-delivery-core="workspace"');
    expect(delivery).toContain('data-delivery-routes="connected"');
    for (const channel of ["Веб-кабинет", "Telegram", "Email", "VK", "Push в браузере", "Webhook"]) {
      expect(delivery).toContain(channel);
    }
    expect(delivery).toContain("<summary>Ещё каналы");
    expect(deliveryCss).toContain(".capabilityBand");

    // The manual outreach boundary is explicit. A restrained contextual
    // message example may illustrate the boundary, but nothing may claim
    // automated sending of messages to companies.
    expect(delivery).toContain('data-manual-outreach-boundary="true"');
    expect(delivery).toContain("Сообщения компаниям не отправляются автоматически");
    expect(delivery).not.toMatch(/сообщения отправляются автоматически|автоматическая рассылка/i);
  });

  it("makes the pilot the only dominant offer and closes on the dark radar echo", () => {
    const conversion = source("app/landing/conversion-panel.tsx");
    const conversionCss = source("app/landing/conversion-panel.module.css");

    expect(conversion).toContain('data-pilot-entry="primary"');
    expect(conversion).toContain('data-pricing-layout="pilot-decision"');
    expect(conversion).toContain('data-faq-layout="centered"');
    expect(conversion).not.toContain("data-recommended={plan.isPrimary");
    expect(conversion).not.toContain("TargetIcon");

    // Final scene echoes the dark ambient hero identity through the
    // abstract radar echo field instead of becoming a second hero.
    expect(conversion).toContain('data-final-radar="echo"');
    expect(conversion).toContain("Сообщения отправляете вы");
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
