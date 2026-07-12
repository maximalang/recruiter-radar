/**
 * @jest-environment jsdom
 *
 * Phase 2 (T2.2) — the profile-form hiring-mode badge carries a semantic SVG
 * icon that matches the resolved mode, so the agency sees *what the radar is
 * doing* at a glance, not just a text label.
 *
 * Contract for the new exported `modeIcon` helper:
 *   specialist → TargetIcon
 *   executive  → TrendIcon  (seniority/leadership framing)
 *   volume     → BriefcaseIcon (hiring-scale framing)
 *   unknown    → null (caller renders no icon)
 *
 * The helper keeps the icon choice in one place so the badge and any future
 * surface (e.g. dashboard) share it.
 */
import { render } from '@testing-library/react';
import type { ReactElement, SVGProps } from 'react';
import { modeIcon } from '@/app/profile/profile-form-helpers';
import { TargetIcon, TrendIcon, BriefcaseIcon } from '@/app/ui/icons';

type IconCmp = (p: SVGProps<SVGSVGElement>) => ReactElement;

describe('modeIcon (T2.2 — hiring-mode → SVG icon)', () => {
  it('maps specialist → TargetIcon', () => {
    const Icon = modeIcon('specialist') as IconCmp | null;
    expect(Icon).toBe(TargetIcon);
  });

  it('maps executive → TrendIcon', () => {
    const Icon = modeIcon('executive') as IconCmp | null;
    expect(Icon).toBe(TrendIcon);
  });

  it('maps volume → BriefcaseIcon', () => {
    const Icon = modeIcon('volume') as IconCmp | null;
    expect(Icon).toBe(BriefcaseIcon);
  });

  it('renders a valid SVG for each known mode', () => {
    for (const m of ['specialist', 'executive', 'volume'] as const) {
      const Icon = modeIcon(m) as IconCmp;
      const { container } = render(<Icon />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    }
  });
});
