/**
 * @jest-environment jsdom
 *
 * Phase 4 (T4.4) — next-steps block replaces the literal "✓ Скопировано" with
 * a CheckIcon SVG + "Скопировано". The external-link ↗ glyph stays as a
 * meaning-bearing copy affordance (consistent with email/Telegram anchors).
 */
import { render, screen, act } from '@testing-library/react';
import NextStepsBlock from '@/app/leads/[id]/next-steps-block';

// Clipboard is unavailable in jsdom; the component falls back to legacyCopy,
// which also creates a textarea + execCommand. We stub navigator.clipboard so
// the "copied" success path is exercised and the CheckIcon renders.
const writeText = jest.fn(() => Promise.resolve());
Object.defineProperty(globalThis, 'navigator', {
  value: { ...globalThis.navigator, clipboard: { writeText } },
  writable: true,
});
Object.defineProperty(window, 'isSecureContext', {
  value: true,
  writable: true,
});

describe('NextStepsBlock (T4.4 — CheckIcon on copied)', () => {
  afterEach(() => writeText.mockClear());

  it('renders the copy button without a literal ✓ before copy', () => {
    render(
      <NextStepsBlock
        crmBlock="CRM text"
        links={[{ href: 'https://x.test', label: 'Сайт компании' }]}
        singleExportHref="/api/leads/x/export"
      />,
    );
    const copyBtn = screen.getByRole('button', { name: /скопировать для crm/i });
    expect(copyBtn.textContent).not.toContain('✓');
  });

  it('renders a CheckIcon SVG after a successful copy (no literal ✓)', async () => {
    const { container } = render(
      <NextStepsBlock
        crmBlock="CRM text"
        links={[]}
        singleExportHref="/api/leads/x/export"
      />,
    );
    const copyBtn = screen.getByRole('button', { name: /скопировать для crm/i });
    await act(async () => {
      copyBtn.click();
    });
    // After copy, the button shows an svg (CheckIcon) + "Скопировано".
    expect(copyBtn.querySelector('svg')).not.toBeNull();
    expect(copyBtn.textContent).not.toContain('✓');
  });
});
