/** @jest-environment jsdom */

import { render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { BrandLockup } from "../../../app/landing/brand-lockup";

/* D3 (R12-REV, landing-v3.1-20261004): colorized wordmark lockup contract.
 * The footer logo (brand-logo.test.tsx), brand15.svg and the hero shotMark
 * are frozen and are NOT touched here. */

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

const COLOR_VARIANTS = ["spectrum", "indigo", "bounded"] as const;

function lockupRoot(container: HTMLElement): SVGSVGElement {
  const root = container.querySelector<SVGSVGElement>("svg[data-brand-lockup]");
  expect(root).not.toBeNull();
  return root!;
}

function wordGradients(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('linearGradient[id^="rr-brand-lockup-word-"]')];
}

function wordMaster(container: HTMLElement): Element | null {
  return wordGradients(container).find((gradient) => !gradient.hasAttribute("href")) ?? null;
}

function wordAliases(container: HTMLElement): Element[] {
  return wordGradients(container).filter((gradient) => gradient.hasAttribute("href"));
}

function glyphPaths(container: HTMLElement): SVGPathElement[] {
  return [...container.querySelectorAll<SVGPathElement>("svg[data-brand-lockup] g > path")];
}

function geometrySnapshot(container: HTMLElement) {
  const root = lockupRoot(container);
  const mark = root.querySelector<SVGSVGElement>("svg");
  const group = root.querySelector<SVGGElement>("g");
  expect(mark).not.toBeNull();
  expect(group).not.toBeNull();
  const glyphs = [...group!.querySelectorAll<SVGPathElement>("path")].map(
    (path) => `${path.getAttribute("d")}|${path.getAttribute("transform")}`,
  );
  return {
    viewBox: root.getAttribute("viewBox"),
    width: root.getAttribute("width"),
    height: root.getAttribute("height"),
    mark: [
      mark!.getAttribute("x"),
      mark!.getAttribute("y"),
      mark!.getAttribute("width"),
      mark!.getAttribute("height"),
      mark!.getAttribute("viewBox"),
    ].join("|"),
    group: group!.getAttribute("transform"),
    glyphs,
  };
}

function stopColorTokens(tsx: string, variant: "spectrum" | "bounded"): string[] {
  const start = tsx.indexOf(`${variant}: [`);
  expect(start).toBeGreaterThan(-1);
  const end = tsx.indexOf("],", start);
  expect(end).toBeGreaterThan(start);
  const block = tsx.slice(start, end);
  return [...block.matchAll(/stopColor: "var\((--v31-[a-z-]+)\)"/g)].map((match) => match[1]);
}

describe("brand lockup D3 color contract (R12-REV)", () => {
  test("defaults to the RECOMMENDED indigo variant with no word gradient", () => {
    const { container } = render(<BrandLockup />);
    const root = lockupRoot(container);

    expect(root.getAttribute("data-color-variant")).toBe("indigo");
    expect(root.getAttribute("data-tone")).toBe("light");
    expect(root.getAttribute("data-brand-lockup")).toBe("a");
    expect(wordGradients(container)).toHaveLength(0);

    const glyphs = glyphPaths(container);
    expect(glyphs).toHaveLength(5);
    glyphs.forEach((glyph) => {
      // Paint is owned by the local CSS module — no presentation fill,
      // no fill=none, no stroke on the wordmark (D3 §4.2/§5.3).
      expect(glyph.getAttribute("fill")).toBeNull();
      expect(glyph.getAttribute("stroke")).toBeNull();
      expect(glyph.style.getPropertyValue("--lockup-word-fill")).toBe("");
      expect(glyph.getAttribute("class")).toBe("wordmarkPath");
    });
  });

  test("keeps the frozen geometry byte-identical across all three color variants", () => {
    const baseline = render(<BrandLockup colorVariant="indigo" />);
    const reference = geometrySnapshot(baseline.container);

    for (const colorVariant of COLOR_VARIANTS) {
      const instance = render(<BrandLockup colorVariant={colorVariant} />);
      expect(geometrySnapshot(instance.container)).toEqual(reference);
      instance.unmount();
    }

    expect(reference.viewBox).toBe("0 0 124 40");
    expect(reference.width).toBe("124");
    expect(reference.height).toBe("40");
    expect(reference.mark).toBe("4|4|32|32|52 47 423 423");
    expect(reference.group).toBe(
      "translate(44.0912889314 30) scale(.0134228187919 -.0134228187919)",
    );
    expect(reference.glyphs.map((entry) => entry.split("|")[1])).toEqual([
      "translate(0 0)",
      "translate(1281 0)",
      "translate(2433 0)",
      "translate(3683 0)",
      "translate(4825 0)",
    ]);
    // Inter 650 outlines are pinned (y-up, em 2048); the second «a» reuses
    // the same glyph geometry as the first.
    expect(reference.glyphs[0].startsWith("M142.2 0V1490H711.6")).toBe(true);
    expect(reference.glyphs[1].split("|")[0]).toBe(reference.glyphs[3].split("|")[0]);
    baseline.unmount();
  });

  test("builds spectrum as one font-space master ramp plus five origin-shifted aliases", () => {
    const { container } = render(<BrandLockup colorVariant="spectrum" />);
    const master = wordMaster(container);
    expect(master).not.toBeNull();

    expect(master!.getAttribute("x1")).toBe("142.2");
    expect(master!.getAttribute("y1")).toBe("0");
    expect(master!.getAttribute("x2")).toBe("5609.85");
    expect(master!.getAttribute("y2")).toBe("0");
    expect(master!.getAttribute("gradientUnits")).toBe("userSpaceOnUse");
    expect(master!.getAttribute("spreadMethod")).toBe("pad");
    expect(master!.getAttribute("color-interpolation")).toBe("sRGB");
    expect([...master!.querySelectorAll("stop")].map((stop) => stop.getAttribute("offset"))).toEqual(
      ["0", ".32", ".64", "1"],
    );

    const aliases = wordAliases(container);
    expect(aliases).toHaveLength(5);
    expect(aliases.map((alias) => alias.getAttribute("gradientTransform"))).toEqual([
      "translate(0 0)",
      "translate(-1281 0)",
      "translate(-2433 0)",
      "translate(-3683 0)",
      "translate(-4825 0)",
    ]);
    aliases.forEach((alias) => {
      expect(alias.getAttribute("href")).toBe(`#${master!.getAttribute("id")}`);
    });

    const glyphs = glyphPaths(container);
    expect(glyphs).toHaveLength(5);
    glyphs.forEach((glyph, index) => {
      expect(glyph.getAttribute("fill")).toBeNull();
      expect(glyph.getAttribute("stroke")).toBeNull();
      expect(glyph.style.getPropertyValue("--lockup-word-fill")).toBe(
        `url(#${aliases[index].getAttribute("id")})`,
      );
    });
  });

  test("builds bounded on the same master geometry with three stops", () => {
    const { container } = render(<BrandLockup colorVariant="bounded" />);
    const master = wordMaster(container);
    expect(master).not.toBeNull();

    expect(master!.getAttribute("x1")).toBe("142.2");
    expect(master!.getAttribute("y1")).toBe("0");
    expect(master!.getAttribute("x2")).toBe("5609.85");
    expect(master!.getAttribute("y2")).toBe("0");
    expect(master!.getAttribute("gradientUnits")).toBe("userSpaceOnUse");
    expect(master!.getAttribute("spreadMethod")).toBe("pad");
    expect(master!.getAttribute("color-interpolation")).toBe("sRGB");
    expect([...master!.querySelectorAll("stop")].map((stop) => stop.getAttribute("offset"))).toEqual(
      ["0", ".58", "1"],
    );
    expect(wordAliases(container)).toHaveLength(5);
  });

  test("paints stop colors from existing tokens only — no hex, no new token names", () => {
    const tsx = source("app/landing/brand-lockup.tsx");
    const css = source("app/landing/brand-lockup.module.css");

    expect(stopColorTokens(tsx, "spectrum")).toEqual([
      "--v31-violet",
      "--v31-indigo",
      "--v31-blue",
      "--v31-cyan",
    ]);
    expect(stopColorTokens(tsx, "bounded")).toEqual([
      "--v31-indigo",
      "--v31-blue",
      "--v31-blue-ink",
    ]);

    const visual = source("app/product-visual-system.css");
    for (const file of [tsx, css]) {
      expect(file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      for (const token of new Set([...file.matchAll(/var\((--v31-[a-z-]+)\)/g)].map((m) => m[1]))) {
        expect(visual).toContain(`${token}:`);
      }
    }
  });

  test("keeps the mark on its own approved gradient in every color variant", () => {
    for (const colorVariant of COLOR_VARIANTS) {
      const { container, unmount } = render(<BrandLockup colorVariant={colorVariant} />);
      const markGradient = container.querySelector(
        'linearGradient[id^="rr-brand-lockup-gradient-"]',
      );
      expect(markGradient).not.toBeNull();
      expect(markGradient!.getAttribute("x1")).toBe("70");
      expect(markGradient!.getAttribute("y1")).toBe("60");
      expect(markGradient!.getAttribute("x2")).toBe("470");
      expect(markGradient!.getAttribute("y2")).toBe("470");
      expect(markGradient!.getAttribute("gradientUnits")).toBe("userSpaceOnUse");
      expect(
        [...markGradient!.querySelectorAll("stop")].map((stop) => stop.getAttribute("offset")),
      ).toEqual(["0", ".37", ".70", "1"]);

      const markPath = container.querySelector<SVGPathElement>("svg[data-brand-lockup] > svg > path");
      expect(markPath).not.toBeNull();
      expect(markPath!.getAttribute("fill")).toBe(`url(#${markGradient!.getAttribute("id")})`);
      expect(markPath!.getAttribute("fill-rule")).toBe("evenodd");
      unmount();
    }
  });

  test("renders every dark-tone variant as the solid tint without word gradients", () => {
    for (const colorVariant of COLOR_VARIANTS) {
      const { container, unmount } = render(<BrandLockup colorVariant={colorVariant} tone="dark" />);
      const root = lockupRoot(container);
      expect(root.getAttribute("data-tone")).toBe("dark");
      expect(root.getAttribute("data-color-variant")).toBe(colorVariant);
      expect(wordGradients(container)).toHaveLength(0);

      glyphPaths(container).forEach((glyph) => {
        expect(glyph.getAttribute("fill")).toBeNull();
        expect(glyph.getAttribute("stroke")).toBeNull();
        expect(glyph.getAttribute("opacity")).toBeNull();
        expect(glyph.style.getPropertyValue("--lockup-word-fill")).toBe("");
      });
      // The mark keeps its own gradient even on dark (D3 §4.7).
      expect(
        container.querySelector('linearGradient[id^="rr-brand-lockup-gradient-"]'),
      ).not.toBeNull();
      unmount();
    }

    const css = source("app/landing/brand-lockup.module.css");
    expect(css).toContain(
      '.lockup[data-tone="dark"] .wordmarkPath { fill: var(--v31-indigo-tint); }',
    );
  });

  test("applies wordmark paint through the local module with a forced-colors fallback", () => {
    const css = source("app/landing/brand-lockup.module.css");

    // D3 §5.2: the pre-I3 rule `.wordmarkPath { fill: currentColor; }` would
    // silently return graphite — paint must flow through the variant-aware
    // module rules instead.
    expect(css).toContain(".wordmarkPath { fill: var(--lockup-word-fill, var(--v31-indigo)); }");
    expect(css).toContain(".lockup { display: block; color: var(--v31-wordmark-ink); }");

    // Forced-colors fallback: currentColor shapes, no gradients (D3 §5.3).
    expect(css).toMatch(
      /@media \(forced-colors: active\) \{[\s\S]*?\.wordmarkPath \{ fill: currentColor; \}[\s\S]*?\}/,
    );
    const outsideFallback = css.replace(
      /@media \(forced-colors: active\) \{[\s\S]*?\}\s*\}/,
      "",
    );
    expect(outsideFallback).not.toContain("fill: currentColor");
  });

  test("keeps accessible naming and focusable contracts unchanged", () => {
    const standalone = render(<BrandLockup />);
    const root = lockupRoot(standalone.container);
    expect(root.getAttribute("role")).toBe("img");
    expect(root.getAttribute("aria-label")).toBe("Recruiter Radar");
    expect(root.getAttribute("focusable")).toBe("false");
    standalone.unmount();

    const decorative = render(<BrandLockup decorative />);
    const decorativeRoot = lockupRoot(decorative.container);
    expect(decorativeRoot.getAttribute("aria-hidden")).toBe("true");
    expect(decorativeRoot.getAttribute("role")).toBeNull();
    expect(decorativeRoot.getAttribute("aria-label")).toBeNull();
    decorative.unmount();
  });

  test("keeps gradient ids unique per instance for two lockups on one page", () => {
    const { container } = render(
      <>
        <BrandLockup colorVariant="spectrum" />
        <BrandLockup colorVariant="bounded" />
      </>,
    );
    const roots = [...container.querySelectorAll<SVGSVGElement>("svg[data-brand-lockup]")];
    expect(roots).toHaveLength(2);

    const masterIds = roots.map((root) => {
      const master = root.querySelector('linearGradient[id^="rr-brand-lockup-word-"]:not([href])');
      expect(master).not.toBeNull();
      return master!.getAttribute("id")!;
    });
    expect(masterIds[0]).not.toBe(masterIds[1]);

    roots.forEach((root, rootIndex) => {
      const ownMasterId = masterIds[rootIndex];
      const ownAliases = [
        ...root.querySelectorAll(`linearGradient[id^="${ownMasterId}-g"]`),
      ].map((alias) => alias.getAttribute("id"));
      expect(ownAliases).toHaveLength(5);
      [...root.querySelectorAll<SVGPathElement>("g > path")].forEach((glyph, index) => {
        expect(glyph.style.getPropertyValue("--lockup-word-fill")).toBe(
          `url(#${ownAliases[index]})`,
        );
      });
    });
  });

  test("preserves geometry variant b with the indigo color default", () => {
    const { container } = render(<BrandLockup variant="b" />);
    const root = container.querySelector<SVGSVGElement>('svg[data-brand-lockup="b"]');
    expect(root).not.toBeNull();
    expect(root!.getAttribute("viewBox")).toBe("0 0 124 36");
    expect(root!.getAttribute("data-color-variant")).toBe("indigo");
    const mark = root!.querySelector<SVGSVGElement>("svg");
    expect(mark!.getAttribute("x")).toBe("4");
    expect(mark!.getAttribute("y")).toBe("4");
    expect(mark!.getAttribute("width")).toBe("28");
    expect(mark!.getAttribute("height")).toBe("28");
    expect(root!.querySelector("g")!.getAttribute("transform")).toBe(
      "translate(37.9004178246 29) scale(.0147651006711 -.0147651006711)",
    );
    expect(wordGradients(container)).toHaveLength(0);
  });
});
