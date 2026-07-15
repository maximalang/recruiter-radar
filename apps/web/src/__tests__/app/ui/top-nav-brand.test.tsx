/** @jest-environment jsdom */
import { render } from '@testing-library/react';
import { TopNav } from '@/app/ui/internal-page';

describe('TopNav brand wordmark', () => {
  it('renders the shared Recruiter Radar artwork', () => {
    const { container } = render(<TopNav items={[]} />);
    const brand = container.querySelector('a.topNavBrand');
    const artwork = brand?.querySelector('img');

    expect(artwork).not.toBeNull();
    expect(artwork).toHaveAttribute('src', expect.stringContaining('/brand/recruiter-radar-logo.svg'));
    expect(artwork).toHaveAttribute('alt', 'Recruiter Radar');
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
    const artwork = brand?.querySelector('img');

    expect(artwork).toHaveAttribute('alt', 'Recruiter Radar');
  });
});
