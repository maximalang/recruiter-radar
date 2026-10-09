import { renderToStaticMarkup } from "react-dom/server";
import StoryPage, { metadata } from "../../../app/story/page";
import { storyCopy } from "../../../app/story/story-copy";

jest.mock("../../../app/story/scroll-demo", () => ({ __esModule: true, default: () => <div data-demo-placeholder /> }));
jest.mock("../../../app/story/story-motion", () => ({ __esModule: true, default: () => null }));

describe("own scroll story server contract", () => {
  it("renders eight ordered scene roles and five field definitions", () => {
    const html = renderToStaticMarkup(<StoryPage />);
    const scenes = [...html.matchAll(/data-story-scene="([^"]+)"/g)].map((match) => match[1]);
    expect(scenes).toEqual(["hero", "demo", "signals", "priority", "contact", "card", "boundary", "closing"]);
    for (const value of [storyCopy.hero_body, storyCopy.contact_example, storyCopy.boundary_note, storyCopy.feature_1_body, storyCopy.feature_2_body, storyCopy.feature_3_body, storyCopy.feature_4_body, storyCopy.feature_5_body]) expect(html).toContain(value);
    expect(html.match(/data-demo-placeholder/g)).toHaveLength(1);
    const demo = html.indexOf('data-demo-placeholder');
    expect(demo).toBeGreaterThan(html.indexOf('data-story-scene="demo"'));
    expect(demo).toBeLessThan(html.indexOf('data-story-scene="signals"'));
    expect(html).not.toContain('problemPath');
    expect(html).not.toContain(storyCopy.problem_body);
    expect(html).not.toContain(storyCopy.problem_h2.replace(/\n/g, "<br/>"));
    expect(html).not.toContain('id="problem"');
    expect(html).toContain('id="workflow"');
    expect(html).toContain('data-test="header"');
    expect(html).toContain('data-header-panel');
    expect(html.match(/data-story-cta=/g)).toHaveLength(3);
    expect(html.match(/<h1 /g)).toHaveLength(1);
    expect(html).toContain('href="https://recruiter-radar.ru"');
    expect(html).toContain('data-hero-visual="true"');
  });
  it("keeps preview non-indexed, truth clean, and the exact 49-copy catalogue", () => {
    expect(Object.keys(storyCopy)).toHaveLength(49);
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates).toEqual({ canonical: "/story" });
    expect(Object.values(storyCopy).join(" ")).not.toMatch(/ежедневн|каждый день|дней назад|предсказыв|990|17×|пост основателя|соцсетях команды|раунде финансирования|горячий, тёплый|сигнал горячий|Они отвечают|Свежий сигнал — свежий ответ/iu);
  });
});
