import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readRepoFile(path: string) {
  return readFileSync(resolve(process.cwd(), "..", "..", path), "utf8");
}

describe("landing production contract", () => {
  it("uses stable deploy and brand anchors instead of marketing copy", () => {
    const page = readRepoFile("apps/web/app/page.tsx");
    const header = readRepoFile("apps/web/app/landing-header.tsx");
    const deploy = readRepoFile(".github/workflows/deploy.yml");

    expect(page).toContain('data-deploy-anchor="landing-private-intelligence-v2"');
    expect(header).toContain('data-brand-header="landing-private-intelligence-v2"');
    expect(header).toContain('data-brand-radar-mark="true"');
    expect(deploy).toContain('data-deploy-anchor="landing-private-intelligence-v2"');
    expect(deploy).toContain('data-brand-header="landing-private-intelligence-v2"');
    expect(deploy).toContain('data-brand-radar-mark="true"');
    expect(deploy).not.toContain("Каждый день Recruiter Radar находит лучшие компании");
    expect(deploy).not.toContain('data-mark="false"');
  });

  it("keeps one scroll margin declaration and passes public analytics build args", () => {
    const css = readRepoFile("apps/web/app/home-page-components.module.css");
    const scrollSection = css.match(/\.scrollSection\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const dockerfile = readRepoFile("apps/web/Dockerfile");
    const deploy = readRepoFile(".github/workflows/deploy.yml");

    expect(scrollSection.match(/scroll-margin-top/g)).toHaveLength(1);
    expect(dockerfile).toContain("ARG NEXT_PUBLIC_YANDEX_METRIKA_ID");
    expect(dockerfile).toContain("ARG NEXT_PUBLIC_LANDING_ANALYTICS_ENDPOINT");
    expect(deploy).toContain("--build-arg NEXT_PUBLIC_YANDEX_METRIKA_ID");
    expect(deploy).toContain("--build-arg NEXT_PUBLIC_LANDING_ANALYTICS_ENDPOINT");
  });
});
