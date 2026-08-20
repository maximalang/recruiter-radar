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

  it("uses a product-specific company brief instead of the signal spine", () => {
    const hero = source("app/landing/detection-scene.tsx");

    expect(hero).toContain('data-hero-layout="company-brief"');
    expect(hero).toContain('data-hero-company-brief="true"');
    expect(hero).toContain("Почему сейчас");
    expect(hero).toContain("Подтверждения");
    expect(hero).toContain("Следующий ход");
    expect(hero).toContain("Сообщения отправляете вы");
    expect(hero).not.toContain('data-hero-layout="signal-spine"');
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

  it("consolidates time, evidence, confidence, and next move into one proof scene", () => {
    const proof = source("app/landing/evidence-scene.tsx");

    expect(proof).toContain('data-proof-story="why-now"');
    expect(proof).toContain("data-proof-event");
    expect(proof).toContain("data-proof-brief");
    expect(proof).toContain("Уровень подтверждения");
    expect(proof).toContain("Следующий ход");
  });

  it("presents the live preview as an editorial product outcome", () => {
    const workspace = source("app/landing/workspace-scene.tsx");

    expect(workspace).toContain('data-preview-editorial="true"');
    expect(workspace).toContain("Посмотрите результат на своей нише");
    expect(workspace).not.toContain("RECRUITER RADAR</strong>");
    expect(workspace).not.toContain("/ ПРИМЕР");
  });

  it("keeps delivery compact while preserving every truthful runtime channel", () => {
    const delivery = source("app/landing/delivery-scene.tsx");

    expect(delivery).toContain('data-delivery-summary="compact"');
    expect(delivery).toContain("Веб-кабинет");
    expect(delivery).toContain("Telegram");
    expect(delivery).toContain("Email");
    expect(delivery).toContain("VK");
    expect(delivery).toContain("Push в браузере");
    expect(delivery).toContain("Webhook");
    expect(delivery).toContain("Сообщения компаниям не отправляются автоматически");
    expect(delivery).not.toContain("outreachDraft");
    expect(delivery).not.toContain("ПРИМЕР СООБЩЕНИЯ");
  });

  it("makes the pilot the only dominant offer and closes without a generic target", () => {
    const conversion = source("app/landing/conversion-panel.tsx");

    expect(conversion).toContain('data-pilot-entry="primary"');
    expect(conversion).not.toContain("data-recommended={plan.isPrimary");
    expect(conversion).not.toContain("TargetIcon");
    expect(conversion).not.toContain("final-radar.module.css");
  });

  it("keeps navigation and FAQ compact", () => {
    const navigation = source("app/landing/landing-copy.ts");
    const faq = source("app/landing/landing-faq.ts");

    expect(navigation).toContain('{ id: "pricing", label: "Тариф" }');
    expect(navigation).toContain('{ id: "faq", label: "FAQ" }');
    expect(faq).not.toContain('question: "Можно посмотреть пример без регистрации?"');
  });
});
