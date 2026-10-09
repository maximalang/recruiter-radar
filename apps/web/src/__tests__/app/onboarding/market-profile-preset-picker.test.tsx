/**
 * @jest-environment jsdom
 *
 * D2 market-profile preset picker — onboarding component contract.
 *
 * The picker renders inside the pilot confirm-profile <form> as radio cards
 * («Инженерный подбор», «Финансовый софт», «Свой профиль»). Selecting a
 * preset must prefill the REAL form fields (specialization, roles,
 * industries, includeKeywords, remoteFriendly) so the user sees and can edit
 * every criterion, and the chosen preset id must be submittable as the
 * `marketProfilePreset` radio value (persisted by the server action).
 */
import { fireEvent, render, screen } from '@testing-library/react';

import { MarketProfilePresetPicker } from '@/app/onboarding/pilot/[orderId]/market-profile-preset-picker';
import { MARKET_PROFILE_PRESETS } from '@/lib/marketProfilePresets';

function renderHarness(selectedPresetId: string | null = null) {
  return render(
    <form>
      <input name="agencyName" defaultValue="Агентство" readOnly />
      <input name="targetCity" defaultValue="" readOnly={false} />
      <input name="specialization" defaultValue="" />
      <input type="checkbox" name="roles" value="it-engineering" />
      <input type="checkbox" name="roles" value="data" />
      <input type="checkbox" name="roles" value="sales" />
      <input type="checkbox" name="industries" value="it" />
      <input type="checkbox" name="industries" value="manufacturing" />
      <input type="checkbox" name="industries" value="energy" />
      <input type="checkbox" name="industries" value="finance" />
      <textarea name="includeKeywords" defaultValue="" />
      <input type="checkbox" name="remoteFriendly" />
      <MarketProfilePresetPicker
        presets={MARKET_PROFILE_PRESETS}
        selectedPresetId={selectedPresetId}
      />
    </form>,
  );
}

function field(container: HTMLElement, selector: string): HTMLInputElement | HTMLTextAreaElement {
  const element = container.querySelector(selector);
  if (!element) throw new Error(`harness field missing: ${selector}`);
  return element as HTMLInputElement;
}

function checkbox(container: HTMLElement, name: string, value: string): HTMLInputElement {
  return field(container, `input[type="checkbox"][name="${name}"][value="${value}"]`) as HTMLInputElement;
}

describe('MarketProfilePresetPicker (D2)', () => {
  it('renders the landing-truth presets and the custom option with criteria visible', () => {
    renderHarness();
    // Preset radios carry the canonical ids as values under one group name.
    const radios = screen.getAllByRole('radio', { name: /./ }) as HTMLInputElement[];
    const values = radios.map((radio) => radio.value);
    expect(values).toContain('engineering-hiring');
    expect(values).toContain('finance-software');
    expect(values).toContain('custom');
    for (const radio of radios) {
      expect(radio.name).toBe('marketProfilePreset');
    }
    // The demo criteria dimensions are visible on the card (ниша / роли / география / признаки спроса).
    expect(screen.getByText('Ниша: Инженерный подбор')).toBeTruthy();
    // both preset cards carry the geography chip → at least two matches
    expect(screen.getAllByText(/География: Вся Россия/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Признаки спроса: инженер, конструктор/)).toBeTruthy();
    expect(screen.getByText('Профиль рынка')).toBeTruthy();
  });

  it('selecting «Инженерный подбор» prefills the real form fields', () => {
    const { container } = renderHarness();
    fireEvent.click(screen.getByRole('radio', { name: /Инженерный подбор/ }));

    expect(field(container, 'input[name="specialization"]').value).toBe('Инженерный подбор');
    expect(checkbox(container, 'roles', 'it-engineering').checked).toBe(true);
    expect(checkbox(container, 'roles', 'data').checked).toBe(true);
    expect(checkbox(container, 'roles', 'sales').checked).toBe(false);
    expect(checkbox(container, 'industries', 'it').checked).toBe(true);
    expect(checkbox(container, 'industries', 'manufacturing').checked).toBe(true);
    expect(checkbox(container, 'industries', 'energy').checked).toBe(true);
    expect(checkbox(container, 'industries', 'finance').checked).toBe(false);

    const keywords = field(container, 'textarea[name="includeKeywords"]').value;
    expect(keywords.split('\n')).toEqual([
      'инженер',
      'конструктор',
      'расширение производства',
      'новая площадка',
    ]);
    expect((field(container, 'input[name="remoteFriendly"]') as HTMLInputElement).checked).toBe(true);
    // unrelated fields untouched
    expect(field(container, 'input[name="agencyName"]').value).toBe('Агентство');
  });

  it('selecting «Финансовый софт» replaces the previously prefilled criteria', () => {
    const { container } = renderHarness();
    fireEvent.click(screen.getByRole('radio', { name: /Инженерный подбор/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Финансовый софт/ }));

    expect(field(container, 'input[name="specialization"]').value).toBe('Финансовый софт');
    expect(checkbox(container, 'roles', 'sales').checked).toBe(true);
    expect(checkbox(container, 'roles', 'data').checked).toBe(false);
    expect(checkbox(container, 'industries', 'finance').checked).toBe(true);
    expect(field(container, 'textarea[name="includeKeywords"]').value).toContain('финтех');
  });

  it('selecting «Свой профиль» leaves manually typed criteria untouched', () => {
    const { container } = renderHarness();
    const specialization = field(container, 'input[name="specialization"]');
    specialization.value = 'Ручная ниша';
    fireEvent.click(screen.getByRole('radio', { name: /Инженерный подбор/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Свой профиль/ }));

    // the engineering prefill happened, custom does not clear or rewrite it
    expect(field(container, 'input[name="specialization"]').value).toBe('Инженерный подбор');
    const customRadio = screen.getByRole('radio', { name: /Свой профиль/ }) as HTMLInputElement;
    expect(customRadio.checked).toBe(true);
  });

  it('restores the persisted preset selection (round-trip from the order/profile)', () => {
    renderHarness('engineering-hiring');
    const radio = screen.getByRole('radio', { name: /Инженерный подбор/ }) as HTMLInputElement;
    expect(radio.checked).toBe(true);
  });

  it('with no persisted preset the custom option is selected', () => {
    renderHarness(null);
    const radio = screen.getByRole('radio', { name: /Свой профиль/ }) as HTMLInputElement;
    expect(radio.checked).toBe(true);
  });
});
