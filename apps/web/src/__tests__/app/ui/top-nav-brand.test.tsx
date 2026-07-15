/** @jest-environment jsdom */
import { render } from '@testing-library/react';
import { TopNav } from '@/app/ui/internal-page';

describe('TopNav brand wordmark', () => {
  it('renders the shared radar mark and wordmark', () => {
    const { container } = render(<TopNav items={[]} />);
    const brand = container.querySelector('a.topNavBrand');
    // BrandLogo renders the approved vector logo (mark + wordmark) as a single
    // <img> whose alt carries the accessible name. The decorative artwork is
    // the image itself; no separate inline <svg> is present.
    const logo = brand?.querySelector('img');

    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute('alt', 'Recruiter Radar');
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
    const logo = brand?.querySelector('img');

    // Accessible name now lives on the logo image's alt (the wordmark is part
    // of the vector artwork, not a separate text node).
    expect(logo).toHaveAttribute('alt', 'Recruiter Radar');
  });
});
