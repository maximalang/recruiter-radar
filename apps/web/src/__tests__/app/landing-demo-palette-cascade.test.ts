import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB_ROOT = existsSync(resolve(process.cwd(), "app"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

function source(path: string): string {
  return readFileSync(resolve(WEB_ROOT, path), "utf8");
}

// R13c (owner verdict R2, defect F-1): the approved detection-scene palette
// is defined by reference head 9eaa919b. The landing-scope B table in
// product-visual-system.css re-values --color-demo-* onto the brand ramp for
// page chrome, which masked the reference values inside the hero demo: the
// module .productShot remaps resolved --color-signal-on-dark to the B-table
// --color-demo-gold (#087ff4) instead of the reference #f0b429, and
// --color-demo-indigo inherited #3725f3 instead of #5e6ad2. A source-string
// check cannot see which cascade layer wins, so this test simulates the
// custom-property cascade for the demo root and asserts the EFFECTIVE
// values against the reference, plus the page-level brand values outside
// the demo (the fix must stay demo-scoped, never a global revert).

type Declarations = Map<string, string>;

interface CssBlock {
  selector: string;
  declarations: Declarations;
  inMedia: boolean;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function collectBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  const walk = (text: string, inMedia: boolean) => {
    let index = 0;
    while (index < text.length) {
      const open = text.indexOf("{", index);
      if (open === -1) return;
      const selector = text.slice(index, open).trim().replace(/\s+/g, " ");
      let depth = 1;
      let cursor = open + 1;
      while (cursor < text.length && depth > 0) {
        if (text[cursor] === "{") depth += 1;
        else if (text[cursor] === "}") depth -= 1;
        cursor += 1;
      }
      const body = text.slice(open + 1, cursor - 1);
      if (selector.startsWith("@media")) {
        walk(body, true);
      } else if (selector.startsWith("@")) {
        walk(body, inMedia);
      } else {
        const declarations: Declarations = new Map();
        for (const declaration of body.split(";")) {
          const separator = declaration.indexOf(":");
          if (separator === -1) continue;
          const property = declaration.slice(0, separator).trim();
          const value = declaration.slice(separator + 1).trim();
          if (property && value) declarations.set(property, value);
        }
        blocks.push({ selector, declarations, inMedia });
      }
      index = cursor;
    }
  };
  walk(css, false);
  return blocks;
}

function mergeMatching(files: Array<{ css: string; mediaScopes: boolean }>, predicate: (selector: string) => boolean): Declarations {
  const merged: Declarations = new Map();
  for (const file of files) {
    for (const block of collectBlocks(stripComments(file.css))) {
      if (block.inMedia && !file.mediaScopes) continue;
      if (!predicate(block.selector)) continue;
      for (const [property, value] of block.declarations) merged.set(property, value);
    }
  }
  return merged;
}

function resolveVars(value: string, scope: Declarations, seen: string[] = []): string {
  return value.replace(/var\(\s*(--[A-Za-z0-9-]+)\s*(?:,\s*([^)]*))?\)/g, (_match, name: string, fallback?: string) => {
    if (seen.includes(name)) return `CYCLE(${name})`;
    const raw = scope.get(name);
    if (raw === undefined) return fallback?.trim() ?? `MISSING(${name})`;
    return resolveVars(raw, scope, [...seen, name]);
  });
}

type RgbaTuple = [number, number, number, number];

function parseColorTuple(value: string): RgbaTuple | null {
  const text = value.trim();
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(text);
  if (hex) {
    const digits = hex[1];
    const byte = (pair: string) => Number.parseInt(pair, 16);
    if (digits.length === 3 || digits.length === 4) {
      const channels = [...digits].map((channel) => byte(channel + channel));
      const alpha = channels.length === 4 ? (channels.pop() as number) / 255 : 1;
      return [channels[0], channels[1], channels[2], alpha];
    }
    if (digits.length === 6 || digits.length === 8) {
      const channels = [byte(digits.slice(0, 2)), byte(digits.slice(2, 4)), byte(digits.slice(4, 6))];
      const alpha = digits.length === 8 ? byte(digits.slice(6, 8)) / 255 : 1;
      return [channels[0], channels[1], channels[2], alpha];
    }
    return null;
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(text);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  return null;
}

function expectColor(actual: string, expected: RgbaTuple, context: string): void {
  const tuple = parseColorTuple(actual);
  if (!tuple) throw new Error(`${context}: unparsable color ${JSON.stringify(actual)}`);
  const alphaClose = Math.abs(tuple[3] - expected[3]) <= 0.005;
  if (tuple[0] !== expected[0] || tuple[1] !== expected[1] || tuple[2] !== expected[2] || !alphaClose) {
    throw new Error(`${context}: ${JSON.stringify(actual)} → [${tuple.join(", ")}] ≠ reference [${expected.join(", ")}]`);
  }
}

const globalsCss = source("app/globals.css");
const visualSystemCss = source("app/product-visual-system.css");
const sceneModuleCss = source("app/landing/detection-scene.module.css");

const rootScope = mergeMatching([{ css: globalsCss, mediaScopes: false }], (selector) => selector === ":root");
const landingScope = mergeMatching(
  [{ css: visualSystemCss, mediaScopes: false }],
  (selector) => selector.includes('[data-theme="inverse"][data-landing-experience]')
    || selector.includes('[data-landing-experience] [data-theme="inverse"]'),
);
const demoScope = mergeMatching([{ css: visualSystemCss, mediaScopes: false }], (selector) => selector === "[data-hero-workflow]");
const productShotScope = mergeMatching([{ css: sceneModuleCss, mediaScopes: false }], (selector) => selector === ".productShot");

// Cascade layers for the demo root, weakest first: :root globals → landing
// scope B table → demo-scope reference restoration → .productShot remaps.
const demoRootScope: Declarations = new Map([
  ...rootScope,
  ...landingScope,
  ...demoScope,
  ...productShotScope,
]);
// Outside the demo the landing scope is the strongest layer.
const pageScope: Declarations = new Map([...rootScope, ...landingScope]);

const effectiveDemo = (token: string): string => resolveVars(demoRootScope.get(token) ?? `MISSING(${token})`, demoRootScope);
const effectivePage = (token: string): string => resolveVars(pageScope.get(token) ?? `MISSING(${token})`, pageScope);

// Reference palette literals from approved head 9eaa919b (globals.css :root
// demo block + .productShot signal remaps in detection-scene.module.css).
const REFERENCE: Record<string, RgbaTuple> = {
  "--color-demo-base-0": [11, 12, 15, 1],
  "--color-demo-base-1": [19, 20, 25, 1],
  "--color-demo-elevated": [30, 31, 33, 1],
  "--color-demo-selected": [32, 33, 35, 1],
  "--color-demo-separator": [42, 43, 46, 1],
  "--color-demo-separator-subtle": [34, 35, 37, 1],
  "--color-demo-panel-top": [36, 37, 44, 1],
  "--color-demo-panel-mid": [26, 27, 32, 1],
  "--color-demo-panel-end": [22, 23, 27, 1],
  "--color-demo-panel-flat": [25, 26, 28, 1],
  "--color-demo-panel-alt": [23, 24, 26, 1],
  "--color-demo-card": [27, 28, 30, 1],
  "--color-demo-indigo": [94, 106, 210, 1],
  "--color-demo-indigo-bright": [123, 134, 232, 1],
  "--color-demo-violet": [157, 123, 232, 1],
  "--color-demo-green": [76, 183, 130, 1],
  "--color-demo-gold": [240, 180, 41, 1],
  "--color-demo-orange": [232, 147, 94, 1],
  "--color-demo-avatar-you": [58, 59, 63, 1],
  "--color-demo-stage-todo": [74, 75, 78, 1],
  "--color-demo-white": [255, 255, 255, 1],
  "--color-demo-text-bright": [220, 221, 223, 1],
  "--color-demo-text-soft": [168, 169, 172, 1],
  "--color-demo-text-muted": [137, 139, 142, 1],
  "--color-demo-text-faint": [105, 107, 112, 1],
  "--color-demo-clear": [255, 255, 255, 0],
  "--color-demo-veil-015": [255, 255, 255, 0.015],
  "--color-demo-veil-022": [255, 255, 255, 0.022],
  "--color-demo-veil-03": [255, 255, 255, 0.03],
  "--color-demo-veil-035": [255, 255, 255, 0.035],
  "--color-demo-veil-05": [255, 255, 255, 0.05],
  "--color-demo-veil-055": [255, 255, 255, 0.055],
  "--color-demo-veil-06": [255, 255, 255, 0.06],
  "--color-demo-veil-07": [255, 255, 255, 0.07],
  "--color-demo-veil-08": [255, 255, 255, 0.08],
  "--color-demo-veil-09": [255, 255, 255, 0.09],
  "--color-demo-veil-10": [255, 255, 255, 0.1],
  "--color-demo-veil-12": [255, 255, 255, 0.12],
  "--color-demo-veil-16": [255, 255, 255, 0.16],
  "--color-demo-glow-indigo": [94, 106, 210, 0.12],
  "--color-demo-glow-indigo-strong": [94, 106, 210, 0.16],
  "--color-demo-gold-ring": [240, 180, 41, 0.1],
  "--color-demo-gold-fill": [240, 180, 41, 0.12],
  "--color-demo-gold-soft": [240, 180, 41, 0.14],
  // pass34 scrims: globals.css values the B table must never re-value.
  "--color-demo-shade": [0, 0, 0, 0.3],
  "--color-demo-scrim-bottom": [5, 6, 8, 0.62],
  "--color-demo-scrim-corner": [5, 6, 8, 0.55],
  "--color-demo-scrim-side": [5, 6, 8, 0.28],
  // .productShot remaps: inside the demo the signal roles are the demo gold.
  "--color-signal": [240, 180, 41, 1],
  "--color-signal-on-dark": [240, 180, 41, 1],
  "--color-signal-soft": [240, 180, 41, 0.14],
};

describe("landing hero demo palette cascade (R13c F-1)", () => {
  it("resolves every demo token to the approved reference inside the demo scope", () => {
    for (const [token, expected] of Object.entries(REFERENCE)) {
      expectColor(effectiveDemo(token), expected, `demo-scope effective ${token}`);
    }
  });

  it("restores the exact tokens flagged by owner defect F-1", () => {
    // QA evidence (t_75ac5c08, run4): computed values on [data-hero-workflow]
    // were #3725f3 / #087ff4 / #087ff4 at head d12ffac9.
    expect(effectiveDemo("--color-demo-indigo")).toBe("#5e6ad2");
    expect(effectiveDemo("--color-demo-gold")).toBe("#f0b429");
    expect(parseColorTuple(effectiveDemo("--color-signal-on-dark"))).toEqual([240, 180, 41, 1]);
  });

  it("restores the reference gold-tinted demo shadows instead of the brand-blue tints", () => {
    const status = effectiveDemo("--shadow-demo-status");
    const stage = effectiveDemo("--shadow-demo-stage");
    expect(status).not.toContain("CYCLE");
    expect(status).not.toContain("MISSING");
    expect(parseColorTuple(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/.exec(status)?.[1] ?? "")?.slice(0, 3)).toEqual([240, 180, 41]);
    expect(parseColorTuple(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/.exec(stage)?.[1] ?? "")?.slice(0, 3)).toEqual([240, 180, 41]);
  });

  it("keeps the page-level brand ramp outside the demo (no global revert)", () => {
    expectColor(effectivePage("--color-signal"), [8, 127, 244, 1], "landing-scope --color-signal");
    expectColor(effectivePage("--color-signal-on-dark"), [5, 201, 239, 1], "landing-scope --color-signal-on-dark");
    expectColor(effectivePage("--color-demo-indigo"), [55, 37, 243, 1], "landing-scope --color-demo-indigo");
    expectColor(effectivePage("--color-demo-gold"), [8, 127, 244, 1], "landing-scope --color-demo-gold");
    expectColor(effectivePage("--color-signal-soft"), [8, 127, 244, 0.14], "landing-scope --color-signal-soft");
  });

  it("declares the demo-scope restoration in the canonical token source, not in a component module", () => {
    expect(demoScope.size).toBeGreaterThan(40);
    const selector = "[data-hero-workflow]";
    expect(visualSystemCss).toContain(selector);
    // The scene module may remap semantic roles but must not carry raw
    // palette literals (semantic visual contract boundary).
    expect(sceneModuleCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sceneModuleCss).not.toMatch(/\brgba?\(/);
  });
});
