/** @jest-environment jsdom */
import { render } from '@testing-library/react';
import { TopNav } from '@/app/ui/internal-page';

describe('TopNav brand wordmark', () => {
  it('renders the exact Recruiter Radar mark and wordmark', () => {
    const { container } = render(<TopNav items={[]} />);
    const brand = container.querySelector('a.topNavBrand');
    const logo = brand?.querySelector('[role="img"][aria-label="Recruiter Radar"]');
    const artwork = logo?.querySelector('img');

    expect(logo).not.toBeNull();
    expect(artwork).not.toBeNull();
    expect(artwork).toHaveAttribute('src', expect.stringContaining('/icon.svg'));
    expect(artwork).toHaveAttribute('alt', '');
    expect(logo?.textContent ?? '').toContain('Recruiter');
    expect(logo?.textContent ?? '').toContain('Radar');
  });

  it('does not render a literal back arrow in the brand', () => {
    const { container } = render(<TopNav items={[]} />);
    const brand = container.querySelector('a.topNavBrand');

    expect(brand).not.toBeNull();
    expect(brand?.textContent ?? '').not.toContain('←');
  });

  it('keeps the "Recruiter Radar" brand label as one accessible name', () => {
    const { container } = render(<TopNav items={[]} />);
    const brand = container.querySelector('a.topNavBrand');
    const logo = brand?.querySelector('[role="img"]');

    expect(logo).toHaveAttribute('aria-label', 'Recruiter Radar');
  });
});
