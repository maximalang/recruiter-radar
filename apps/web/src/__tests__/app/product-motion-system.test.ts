import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = resolve(process.cwd(), 'app');
const layout = readFileSync(resolve(appRoot, 'layout.tsx'), 'utf8');
const motion = readFileSync(resolve(appRoot, 'product-motion-system.css'), 'utf8');
const internalPage = readFileSync(
  resolve(appRoot, 'ui', 'internal-page.module.css'),
  'utf8',
);

describe('product motion system', () => {
  it('loads a shared motion layer between visual tokens and interaction safety', () => {
    expect(layout).toContain('import "./product-motion-system.css";');
    expect(layout.indexOf('product-motion-system.css')).toBeGreaterThan(
      layout.indexOf('product-visual-system.css'),
    );
    expect(layout.indexOf('site-interactions.css')).toBeGreaterThan(
      layout.indexOf('product-motion-system.css'),
    );
  });

  it('defines a restrained timing vocabulary and opt-in primitives', () => {
    for (const contract of [
      '--rr-motion-duration-fast: 120ms',
      '--rr-motion-duration-control: 160ms',
      '--rr-motion-duration-disclosure: 180ms',
      '--rr-motion-duration-emphasis: 220ms',
      '--rr-motion-ease-standard:',
      '--rr-motion-ease-enter:',
      '--rr-motion-distance-short: 4px',
      '[data-motion-interactive]',
      '[data-motion-list]',
      '[data-motion-status]',
      '[data-motion-disclosure]',
    ]) {
      expect(motion).toContain(contract);
    }
  });

  it('keeps idle surfaces static and preserves information with reduced motion', () => {
    expect(motion).toContain('@media (prefers-reduced-motion: reduce)');
    expect(motion).toContain('transition-duration: 0.01ms');
    expect(motion).toContain('transform: none');
    expect(motion).not.toContain('animation-iteration-count: infinite');
    expect(internalPage).not.toContain('@keyframes pageFadeIn');
    expect(internalPage).not.toContain('animation: pageFadeIn');
    expect(internalPage).not.toContain('will-change: opacity, transform');
  });
});
