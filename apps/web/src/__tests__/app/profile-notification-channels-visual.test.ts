import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string) {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

describe("notification channel visual contract", () => {
  it("keeps channel configuration in the calm workspace surface grammar", () => {
    const styles = source("app/profile/notification-channels.module.css");

    expect(styles).not.toContain("var(--color-information)");
    expect(styles).not.toMatch(/background:\s*linear-gradient/);
    expect(styles).not.toContain("var(--radius-overlay)");

    expect(styles).toMatch(/\.addCard\s*\{[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;/);
    expect(styles).toMatch(/\.connectionCard\s*\{[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;/);
    expect(styles).toMatch(/\.endpointRow\s*\{[\s\S]*?background:\s*transparent;/);
    expect(styles).toMatch(/\.empty\s*\{[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent;/);
  });

  it("keeps channel controls on the product interaction target contract", () => {
    const styles = source("app/profile/notification-channels.module.css");

    expect(styles).toMatch(/\.form input\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(styles).toMatch(/\.submit,[\s\S]*?\.secondaryLink\s*\{[\s\S]*?min-height:\s*44px;/);
    expect(styles).toContain("outline: 2px solid var(--color-focus)");
  });
});
