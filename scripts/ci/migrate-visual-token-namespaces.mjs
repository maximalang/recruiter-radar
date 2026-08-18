import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve('apps/web/app');
const extensions = new Set(['.css', '.ts', '.tsx']);
const tokenSources = new Set([
  path.resolve('apps/web/app/globals.css'),
  path.resolve('apps/web/app/product-visual-system.css'),
]);

const rawColorLiteral = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g;

const semantic = {
  canvas: '--color-canvas',
  surfacePrimary: '--color-surface-primary',
  surfaceSecondary: '--color-surface-secondary',
  surfaceSelected: '--color-surface-selected',
  surfaceElevated: '--color-surface-elevated',
  textPrimary: '--color-text-primary',
  textSecondary: '--color-text-secondary',
  textTertiary: '--color-text-tertiary',
  separator: '--color-separator',
  separatorStrong: '--color-separator-strong',
  signal: '--color-signal',
  signalHover: '--color-signal-hover',
  copper: '--color-copper',
  positive: '--color-positive',
  warning: '--color-warning',
  destructive: '--color-destructive',
  information: '--color-information',
};

function filesUnder(root) {
  if (!statSync(root).isDirectory()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

function parseHex(value) {
  const hex = value.slice(1);
  const expanded = hex.length <= 4 ? [...hex].map((char) => char + char).join('') : hex;
  const hasAlpha = expanded.length === 8;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
    a: hasAlpha ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
  };
}

function parseRgb(value) {
  const parts = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')')).split(',').map((part) => part.trim());
  if (parts.length < 3 || parts.slice(0, 3).some((part) => part.endsWith('%'))) return null;
  const [r, g, b] = parts.slice(0, 3).map(Number);
  const a = parts.length > 3 ? Number(parts[3]) : 1;
  if (![r, g, b, a].every(Number.isFinite)) return null;
  return { r, g, b, a };
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0, lightness };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue;
  if (max === rn) hue = 60 * (((gn - bn) / delta) % 6);
  else if (max === gn) hue = 60 * ((bn - rn) / delta + 2);
  else hue = 60 * ((rn - gn) / delta + 4);
  if (hue < 0) hue += 360;
  return { hue, saturation, lightness };
}

function hueToken(hue) {
  if (hue >= 345 || hue < 20) return semantic.destructive;
  if (hue < 48) return semantic.copper;
  if (hue < 78) return semantic.warning;
  if (hue < 175) return semantic.signal;
  if (hue < 260) return semantic.information;
  if (hue < 330) return semantic.information;
  return semantic.destructive;
}

function opaqueSemantic(color) {
  const { hue, saturation, lightness } = rgbToHsl(color);

  if (lightness >= 0.965 && saturation < 0.12) return `var(${semantic.surfaceElevated})`;
  if (lightness >= 0.82) {
    if (saturation >= 0.16) {
      const token = hueToken(hue);
      const weight = lightness >= 0.92 ? 10 : 16;
      return `color-mix(in srgb, var(${token}) ${weight}%, var(${semantic.surfacePrimary}))`;
    }
    return lightness >= 0.9 ? `var(${semantic.surfacePrimary})` : `var(${semantic.surfaceSecondary})`;
  }

  if (saturation >= 0.18) return `var(${hueToken(hue)})`;
  if (lightness <= 0.22) return `var(${semantic.textPrimary})`;
  if (lightness <= 0.42) return `var(${semantic.textSecondary})`;
  if (lightness <= 0.62) return `var(${semantic.textTertiary})`;
  if (lightness <= 0.78) return `var(${semantic.separatorStrong})`;
  return `var(${semantic.separator})`;
}

function translucentSemantic(color) {
  const { hue, saturation, lightness } = rgbToHsl(color);
  let token;
  if (saturation >= 0.16) token = hueToken(hue);
  else if (lightness >= 0.82) token = semantic.surfaceElevated;
  else if (lightness <= 0.28) token = semantic.textPrimary;
  else if (lightness <= 0.55) token = semantic.textSecondary;
  else token = semantic.separatorStrong;

  const alpha = Math.max(0, Math.min(1, color.a));
  if (alpha <= 0) return 'transparent';
  const percent = Number((alpha * 100).toFixed(1));
  return `color-mix(in srgb, var(${token}) ${percent}%, transparent)`;
}

function semanticColor(value) {
  const parsed = value.startsWith('#') ? parseHex(value) : parseRgb(value);
  if (!parsed) return value;
  return parsed.a < 0.999 ? translucentSemantic(parsed) : opaqueSemantic(parsed);
}

let changed = 0;
for (const file of filesUnder(appRoot)) {
  if (!extensions.has(path.extname(file)) || tokenSources.has(file)) continue;
  const before = readFileSync(file, 'utf8');
  const after = before.replace(rawColorLiteral, semanticColor);
  if (after === before) continue;
  writeFileSync(file, after);
  changed += 1;
}

console.log(`Normalized legacy visual palettes in ${changed} UI files.`);
