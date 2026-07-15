/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';

import { BrandLogo } from '../../../../app/ui/brand-logo';

describe('BrandLogo', () => {
  it('renders a transparent minimal mark without a background shape or gradient', () => {
    const { container } = render(<BrandLogo />);

    expect(screen.getByText(/Recruiter/)).toBeTruthy();
    expect(container.querySelector('rect')).toBeNull();
    expect(container.querySelector('linearGradient')).toBeNull();
    expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(4);
  });
});
