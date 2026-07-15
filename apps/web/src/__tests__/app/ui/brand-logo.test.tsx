/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';

import { BrandLogo } from '../../../../app/ui/brand-logo';

describe('BrandLogo', () => {
  it('renders the supplied two-line radar wordmark without a background shape', () => {
    const { container } = render(<BrandLogo />);

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });
    expect(logo.getAttribute('viewBox')).toBe('0 0 640 220');
    expect(screen.getByText('Recruiter')).toBeTruthy();
    expect(screen.getByText('Radar')).toBeTruthy();
    expect(container.querySelector('rect')).toBeNull();
    expect(container.querySelector('linearGradient')).toBeNull();
  });

  it('keeps a compact mark-only variant for narrow brand placements', () => {
    const { container } = render(
      <BrandLogo tone="dark" size="small" showWordmark={false} />
    );

    const logo = screen.getByRole('img', { name: 'Recruiter Radar' });
    expect(logo.getAttribute('viewBox')).toBe('0 0 212 212');
    expect(container.querySelector('[data-tone="dark"]')).toBeTruthy();
    expect(screen.queryByText('Recruiter')).toBeNull();
    expect(screen.queryByText('Radar')).toBeNull();
  });
});
