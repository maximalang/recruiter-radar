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
  it("restores the timeline scene between the promise and the proof", () => {
    const page = source("app/landing/landing-page.tsx");
    const heroIndex = page.indexOf("<DetectionScene");
    const proofIndex = page.indexOf("<EvidenceScene");

    expect(heroIndex).toBeGreaterThan(-1);
    expect(proofIndex).toBeGreaterThan(heroIndex);
    const timelineIndex = page.indexOf("<SignalTimeline />");
    expect(timelineIndex).toBeGreaterThan(heroIndex);
    expect(timelineIndex).toBeLessThan(proofIndex);
    expect(page).not.toContain("<WorkspaceScene");
    expect(page).not.toContain("<RadarScene");
  });

  it("keeps the restored ambient hero payment-aware and connected to the preview", () => {
    const hero = source("app/landing/detection-scene.tsx");

    expect(hero).toContain('data-hero-layout="interactive-workflow"');
    expect(hero).toContain('data-theme="inverse"');
    expect(hero).toContain("data-payment-offer=");
    expect(hero).toContain("Посмотреть, как это работает");
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

  it("presents the interactive hero demo as one coherent Recruiter Radar product object", () => {
    const hero = source("app/landing/hero-product-preview.tsx");

    // Single example (PART 2): the interactive workflow demo replaces the
    // retired static workspace story.
    expect(hero).toContain('data-hero-product-preview="workflow"');
    expect(hero).toContain('id="hero-workflow"');
    expect(hero).toContain("Интерактивный workflow");
    expect(hero).toContain("Черновик готов — отправляете только вы");
    expect(hero).not.toContain("data-lead-row");
    expect(hero).not.toContain("getStaticDemoDigestItems");
    expect(existsSync(resolve(WEB_ROOT, "app/landing/workspace-scene.tsx"))).toBe(false);
    expect(existsSync(resolve(WEB_ROOT, "app/landing/workspace-lead.tsx"))).toBe(false);
    expect(existsSync(resolve(WEB_ROOT, "app/landing/workspace-lead-list.tsx"))).toBe(false);
    expect(existsSync(resolve(WEB_ROOT, "app/landing/workspace-scene.module.css"))).toBe(false);
  });

  it("tells the delivery story around the manual outreach boundary with truthful channels", () => {
    const delivery = source("app/landing/delivery-scene.tsx");
    const deliveryCss = source("app/landing/delivery-scene.module.css");

    // Delivery headline: results arrive where the user already works.
    expect(delivery).toContain("Результаты приходят туда, где вы работаете");

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

  it("makes the pilot the only dominant offer and closes on manual outreach proof", () => {
    const conversion = source("app/landing/conversion-panel.tsx");
    const conversionCss = source("app/landing/conversion-panel.module.css");

    expect(conversion).toContain('data-pilot-entry="primary"');
    expect(conversion).toContain('data-pricing-layout="pilot-decision"');
    expect(conversion).toContain('data-faq-layout="centered"');
    expect(conversion).not.toContain("data-recommended={plan.isPrimary");
    expect(conversion).not.toContain("TargetIcon");

    // Final scene resolves the journey with explicit human control instead of
    // repeating the retired abstract radar echo treatment.
    expect(conversion).not.toContain('data-final-radar="echo"');
    expect(conversion).toContain('data-final-proof="manual-outreach"');
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
