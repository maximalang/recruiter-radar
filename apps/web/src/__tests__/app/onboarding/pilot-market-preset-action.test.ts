/**
 * D2 market-profile preset — pilot onboarding server action contract.
 *
 * confirmPilotProfileAction must:
 * - normalize the submitted `marketProfilePreset` radio value against the
 *   registry to the recorded tri-state (canonical preset id | the explicit
 *   "custom" sentinel | null for no recorded choice — unknown/forged values
 *   never persist garbage);
 * - use preset criteria ONLY as fallbacks for fields the submission left
 *   empty — user-entered values always win («критерии можно изменить в
 *   любой момент»);
 * - pass the recorded choice to confirmPilotOrderProfile so it persists on
 *   the order payload — the explicit custom choice as the "custom" sentinel,
 *   distinguishable from a legacy absence (F-1, PR260 QA run959).
 */
jest.mock('@/lib/payments', () => ({
  confirmPilotOrderProfile: jest.fn(),
  completePilotOrderOnboarding: jest.fn(),
  sendPilotOrderTestDigest: jest.fn(),
}));
jest.mock('@/lib/auth-v2/authorization', () => ({
  getSession: jest.fn(),
}));

import { confirmPilotProfileAction } from '@/app/onboarding/pilot/[orderId]/actions';
import { confirmPilotOrderProfile } from '@/lib/payments';
import { getSession } from '@/lib/auth-v2/authorization';
import { MARKET_PROFILE_PRESETS } from '@/lib/marketProfilePresets';

const mockConfirm = jest.mocked(confirmPilotOrderProfile);
const mockGetSession = jest.mocked(getSession);

const ENGINEERING = MARKET_PROFILE_PRESETS.find((p) => p.id === 'engineering-hiring')!;

function baseFormData(): FormData {
  const formData = new FormData();
  formData.set('orderId', 'o1');
  formData.set('agencyName', 'Агентство');
  return formData;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({
    workspaceId: '9',
    dataOwnerId: '42',
  } as never);
  mockConfirm.mockResolvedValue({} as never);
});

describe('confirmPilotProfileAction — market-profile preset (D2)', () => {
  it('applies the «Инженерный подбор» preset criteria when the form fields are empty', async () => {
    const formData = baseFormData();
    formData.set('marketProfilePreset', 'engineering-hiring');

    await confirmPilotProfileAction('o1', formData);

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'o1',
        agencyName: 'Агентство',
        specialization: 'Инженерный подбор',
        roles: [...ENGINEERING.criteria.roles],
        industries: [...ENGINEERING.criteria.industries],
        includeKeywords: [...ENGINEERING.criteria.demandSignals],
        marketProfilePreset: 'engineering-hiring',
        // checkbox absent from the submission → form truth, no hidden fallback
        remoteFriendly: false,
        workspaceId: '9',
        entitlementOwnerId: '42',
      }),
    );
  });

  it('user-entered criteria win over the preset; the preset id is still recorded', async () => {
    const formData = baseFormData();
    formData.set('marketProfilePreset', 'engineering-hiring');
    formData.set('specialization', 'Своя ниша');
    formData.append('roles', 'sales');
    formData.set('includeKeywords', 'своя фраза\nвторая фраза');
    formData.set('remoteFriendly', 'on');

    await confirmPilotProfileAction('o1', formData);

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        specialization: 'Своя ниша',
        roles: ['sales'],
        includeKeywords: ['своя фраза', 'вторая фраза'],
        remoteFriendly: true,
        marketProfilePreset: 'engineering-hiring',
      }),
    );
  });

  it('the explicit custom choice persists the "custom" sentinel and applies no fallbacks', async () => {
    const formData = baseFormData();
    formData.set('marketProfilePreset', 'custom');

    await confirmPilotProfileAction('o1', formData);

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        specialization: null,
        roles: [],
        includeKeywords: [],
        // Distinguishable recorded choice — NOT the legacy null (F-1).
        marketProfilePreset: 'custom',
      }),
    );
  });

  it('an unknown/forged preset value is rejected against the registry', async () => {
    const formData = baseFormData();
    formData.set('marketProfilePreset', 'mass-outreach-preset');

    await confirmPilotProfileAction('o1', formData);

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        specialization: null,
        // Forged garbage is not a recorded choice — it must never persist as
        // the custom sentinel nor as a preset id.
        marketProfilePreset: null,
      }),
    );
  });

  it('a legacy submission without the preset field keeps the previous behaviour', async () => {
    const formData = baseFormData();
    formData.set('specialization', 'Промышленный подбор');

    await confirmPilotProfileAction('o1', formData);

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        specialization: 'Промышленный подбор',
        marketProfilePreset: null,
      }),
    );
  });

  it('rejects an order id mismatch before touching the preset logic', async () => {
    const formData = baseFormData();
    formData.set('marketProfilePreset', 'engineering-hiring');

    await expect(confirmPilotProfileAction('other-order', formData)).rejects.toThrow(
      'Order mismatch.',
    );
    expect(mockConfirm).not.toHaveBeenCalled();
  });
});
