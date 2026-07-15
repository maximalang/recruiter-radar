/** @jest-environment jsdom */
import { render } from '@testing-library/react';
import { TopNav } from '@/app/ui/internal-page';

describe('TopNav brand wordmark', () => {
  it('renders the shared radar mark and wordmark', () => {
    const { container } = render(<TopNav items={[]} />);
    const brand = container.querySelector('a.topNavBrand');
    const mark = brand?.querySelector('svg');

    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(brand?.textContent ?? '').toContain('Recruiter Radar');
  });

  it('does not render a literal back arrow in the brand', () => {
    const { container } = render(<TopNav items={[]} />);
    const brand = container.querySelector('a.topNavBrand');

    expect(brand).not.toBeNull();
    expect(brand?.textContent ?? '').not.toContain('←');
  });

  it('keeps the "Recruiter Radar" brand label as the accessible name', () => {
    const { container } = render(<TopNav items={[]} />);
    const brand = container.querySelector('a.topNavBrand');

    expect(brand?.textContent ?? '').toContain('Recruiter Radar');
  });
});
