import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve('apps/web/app');
const extensions = new Set(['.css', '.tsx', '.ts']);
const tokenSources = new Set([
  path.resolve('apps/web/app/globals.css'),
  path.resolve('apps/web/app/product-visual-system.css'),
]);
const canonicalMotionSource = path.resolve('apps/web/app/product-motion-system.css');
const globalInteractionLayer = path.resolve('apps/web/app/site-interactions.css');
const rawColorLiteral = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)|\bhwb\([^)]*\)/g;
const namedColorDeclaration = /\b(?:color|background(?:-color)?|border(?:-[a-z]+)?-color|outline-color|fill|stroke)\s*:\s*(black|white|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|navy|teal|cyan|magenta)\b/gi;
const bannedTokenNamespace = /--(?:c|rr|slate)-[a-z0-9-]+/gi;
const bannedLandingAlias = /--(?:paper(?:-soft|-strong)?|ink|muted-(?:dark|light)|line-(?:dark|light)|signal(?:-strong|-deep|-soft)?|copper|warning|surface-radius)\b/gi;
const versionedVisualMarker = /recruiter-radar-(?:landing-)?v\d+/gi;
const cssRadiusDeclaration = /border-radius\s*:\s*([^;}\n]+)/gi;
const jsRadiusDeclaration = /\bborderRadius\s*:\s*(?:"([^"]+)"|'([^']+)'|(\d+(?:\.\d+)?))/g;
const cssBoxShadowDeclaration = /box-shadow\s*:\s*([^;}\n]+)/gi;
const jsBoxShadowDeclaration = /\bboxShadow\s*:\s*(?:"([^"]+)"|'([^']+)')/g;
const textShadowDeclaration = /text-shadow\s*:\s*([^;}\n]+)/gi;
const dropShadow = /drop-shadow\s*\(/gi;
const localLength = /(?:^|[\s(,+-])\d*\.?\d+(?:px|rem|em)\b/i;
const cssMotionDeclaration = /\b(?:transition(?:-property|-duration|-delay|-timing-function)?|animation(?:-name|-duration|-delay|-timing-function|-iteration-count)?)\s*:\s*([^;}]+)/gi;
const cssTimeLiteral = /(?:^|[\s,])((?:\d*\.)?\d+)(ms|s)\b/gi;
const componentClassSelector = /\[class(?:[*^$|~]?=)/i;
const localEasing = /\b(?:ease(?:-in|-out|-in-out)?|linear|cubic-bezier|steps)\b/i;
const infiniteMotion = /\binfinite\b/i;
const transitionAll = /(?:^|[\s,])all(?:[\s,]|$)/i;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return extensions.has(path.extname(entry.name)) ? [absolute] : [];
  });
}

function relative(file) {
  return path.relative(process.cwd(), file).replaceAll(path.sep, '/');
}

function matches(regex, content) {
  regex.lastIndex = 0;
  return [...content.matchAll(regex)];
}

function isReducedMotionSentinel(value, unit) {
  const milliseconds = unit === 's' ? Number(value) * 1000 : Number(value);
  return milliseconds <= 0.01;
}

function withoutCanonicalMotionTokens(value) {
  return value
    .replaceAll(/var\(--motion-(?:duration|ease)-[a-z0-9-]+\)/gi, '')
    .trim();
}

const failures = [];
for (const file of sourceFiles(appRoot)) {
  const content = readFileSync(file, 'utf8');
  const label = relative(file);
  const isCss = path.extname(file) === '.css';

  for (const token of new Set(content.match(bannedTokenNamespace) ?? [])) {
    failures.push(`${label}: banned token namespace ${token}`);
  }

  if (label.startsWith('apps/web/app/landing/')) {
    for (const token of new Set(content.match(bannedLandingAlias) ?? [])) {
      failures.push(`${label}: banned landing alias ${token}`);
    }
  }

  if (isCss) {
    for (const marker of new Set(content.match(versionedVisualMarker) ?? [])) {
      failures.push(`${label}: versioned visual marker ${marker}`);
    }
  }

  if (file === globalInteractionLayer && componentClassSelector.test(content)) {
    failures.push(`${label}: component-class compatibility selector in global interaction layer`);
  }

  for (const match of matches(cssRadiusDeclaration, content)) {
    const value = match[1].trim();
    if (localLength.test(value)) failures.push(`${label}: local border-radius ${value}`);
  }
  for (const match of matches(jsRadiusDeclaration, content)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (/^\d+(?:\.\d+)?$/.test(value) ? Number(value) !== 0 : localLength.test(value)) {
      failures.push(`${label}: local borderRadius ${value}`);
    }
  }

  for (const match of matches(cssBoxShadowDeclaration, content)) {
    const value = match[1].trim();
    if (!value.startsWith('none') && !value.startsWith('var(--shadow-')) {
      failures.push(`${label}: local box-shadow ${value}`);
    }
  }
  for (const match of matches(jsBoxShadowDeclaration, content)) {
    const value = (match[1] ?? match[2] ?? '').trim();
    if (!value.startsWith('none') && !value.startsWith('var(--shadow-')) {
      failures.push(`${label}: local boxShadow ${value}`);
    }
  }
  for (const match of matches(textShadowDeclaration, content)) {
    const value = match[1].trim();
    if (!value.startsWith('none')) failures.push(`${label}: local text-shadow ${value}`);
  }
  if (dropShadow.test(content)) failures.push(`${label}: local drop-shadow filter`);
  dropShadow.lastIndex = 0;

  if (isCss && file !== canonicalMotionSource) {
    for (const declaration of matches(cssMotionDeclaration, content)) {
      const value = declaration[1].trim();
      for (const time of matches(cssTimeLiteral, value)) {
        const number = time[1];
        const unit = time[2];
        if (!isReducedMotionSentinel(number, unit)) {
          failures.push(`${label}: local motion timing ${number}${unit} in ${value}`);
        }
      }
      const stripped = withoutCanonicalMotionTokens(value);
      if (localEasing.test(stripped)) {
        failures.push(`${label}: local motion easing in ${value}`);
      }
      if (infiniteMotion.test(value)) {
        failures.push(`${label}: infinite motion outside canonical pending primitive in ${value}`);
      }
      if (declaration[0].toLowerCase().startsWith('transition') && transitionAll.test(value)) {
        failures.push(`${label}: transition-all is not allowed in ${value}`);
      }
    }
  }

  if (tokenSources.has(file)) continue;

  for (const literal of new Set(content.match(rawColorLiteral) ?? [])) {
    failures.push(`${label}: hardcoded color ${literal}`);
  }
  for (const match of matches(namedColorDeclaration, content)) {
    failures.push(`${label}: hardcoded named color ${match[1]}`);
  }
}

if (failures.length) {
  console.error('Semantic visual contract failed. Components must use canonical visual and motion primitives without compatibility selectors.');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Semantic visual contract passed: canonical namespaces, colors, radii, shadows, motion, and compatibility boundaries only.');
