/**
 * F-1 regression (PR260 QA run959) — the explicit «Свой профиль» (custom)
 * market-profile choice must survive the full round-trip:
 * server action → persisted JSONB payload → payload normalization → page
 * re-selection → picker SSR → resubmit → second save.
 *
 * Defect at frozen anchor a3011cb7: the action recorded an explicit custom
 * choice as marketProfilePreset=null — indistinguishable from a legacy payload
 * that never recorded a choice. page.tsx then resolved `null ?? profile?.
 * specialization`, so a custom profile that kept a preset-like specialization
 * text (e.g. «Инженерный подбор») re-selected the registry preset, and the
 * next save refilled empty roles/includeKeywords from the preset criteria
 * (QA run959: 4/4 cases lost the custom choice; 2/4 resurrected criteria).
 *
 * This suite executes UNMODIFIED on both the defective and the fixed head:
 * the page selection expression and the payments persist expression are
 * extracted verbatim from the real sources and evaluated against the real
 * registry module (same methodology as QA evidence/run959_custom_probe.cjs);
 * persistence uses the real mergeCheckoutOrderPayload + mapCheckoutOrderRow;
 * the picker is the real component SSR'd by the real React. Mock boundaries:
 * the auth session (permission granted) and the payments persistence
 * (capture only — no DB write).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";

import * as react from "react";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/lib/payments", () => ({
  confirmPilotOrderProfile: jest.fn(),
  completePilotOrderOnboarding: jest.fn(),
  sendPilotOrderTestDigest: jest.fn(),
}));
jest.mock("@/lib/auth-v2/authorization", () => ({
  getSession: jest.fn(),
}));

import { confirmPilotProfileAction } from "@/app/onboarding/pilot/[orderId]/actions";
import { MarketProfilePresetPicker } from "@/app/onboarding/pilot/[orderId]/market-profile-preset-picker";
import { confirmPilotOrderProfile } from "@/lib/payments";
import { getSession } from "@/lib/auth-v2/authorization";
import * as marketProfilePresets from "@/lib/marketProfilePresets";
import {
  mapCheckoutOrderRow,
  mergeCheckoutOrderPayload,
} from "@/lib/paymentsNormalize";
import type {
  CheckoutOrder,
  CheckoutOrderPayload,
  CheckoutOrderRow,
} from "@/lib/paymentsTypes";

const WEB_ROOT = path.resolve(__dirname, "../../../..");

const mockConfirm = jest.mocked(confirmPilotOrderProfile);
const mockGetSession = jest.mocked(getSession);

type ConfirmInput = Parameters<typeof confirmPilotOrderProfile>[0];

// ---------------------------------------------------------------------------
// Source-contract extraction — identical on the defective and the fixed head.
// ---------------------------------------------------------------------------

function extractBalancedJsxExpression(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`source marker not found: ${marker}`);
  }
  let depth = 1;
  let index = start + marker.length;
  const begin = index;
  while (index < source.length && depth > 0) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    index += 1;
  }
  if (depth !== 0) {
    throw new Error(`unbalanced braces after marker: ${marker}`);
  }
  return source.slice(begin, index - 1);
}

const PAGE_SOURCE = fs.readFileSync(
  path.join(WEB_ROOT, "app", "onboarding", "pilot", "[orderId]", "page.tsx"),
  "utf8",
);
const PAYMENTS_SOURCE = fs.readFileSync(
  path.join(WEB_ROOT, "lib", "payments.ts"),
  "utf8",
);

const PAGE_SELECTION_EXPRESSION = extractBalancedJsxExpression(
  PAGE_SOURCE,
  "selectedPresetId={",
);

const PAYMENTS_PERSIST_MATCH = PAYMENTS_SOURCE.match(
  /marketProfilePreset:\s*[A-Za-z_$][\w$]*\(input\.marketProfilePreset\)/,
);
if (!PAYMENTS_PERSIST_MATCH) {
  throw new Error("payments marketProfilePreset persist expression not found");
}
const PAYMENTS_PERSIST_EXPRESSION = PAYMENTS_PERSIST_MATCH[0];

function evalWithRealRegistry(
  expression: string,
  scope: Record<string, unknown>,
): unknown {
  return vm.runInNewContext(expression, { ...marketProfilePresets, ...scope });
}

/** The exact value lib/payments.ts writes into the JSONB payload as the recorded choice. */
function persistedPresetChoice(confirmInput: ConfirmInput): unknown {
  const persisted = evalWithRealRegistry(`({ ${PAYMENTS_PERSIST_EXPRESSION} })`, {
    input: confirmInput,
  }) as { marketProfilePreset: unknown };
  return persisted.marketProfilePreset;
}

/** The exact preset id the onboarding page hands to the picker for this order/profile. */
function pageSelectedPresetId(
  order: CheckoutOrder,
  profile: { specialization: string | null } | null,
): string | null {
  const selected = evalWithRealRegistry(PAGE_SELECTION_EXPRESSION, {
    order,
    profile,
  });
  return typeof selected === "string" ? selected : null;
}

// ---------------------------------------------------------------------------
// Real persistence pipeline: merge → JSONB stringify/parse → row normalize.
// ---------------------------------------------------------------------------

function buildOrderRow(payloadJson: unknown): CheckoutOrderRow {
  return {
    id: "77",
    purchasedByUserId: "5",
    workspaceId: "9",
    entitlementOwnerId: "42",
    productCode: "pilot",
    amountMinor: 99000,
    currency: "RUB",
    status: "paid",
    customerName: "Roundtrip QA",
    customerContact: null,
    payload: payloadJson,
    provider: null,
    providerPaymentId: null,
    createdAt: "2026-10-01T00:00:00+00:00",
    updatedAt: "2026-10-01T00:00:00+00:00",
    paidAt: "2026-10-01T00:00:00+00:00",
  };
}

function persistConfirm(
  currentRawPayload: Record<string, unknown>,
  confirmInput: ConfirmInput,
): { raw: Record<string, unknown>; order: CheckoutOrder } {
  const current = mapCheckoutOrderRow(buildOrderRow(currentRawPayload));
  const merged = mergeCheckoutOrderPayload(current.payload, {
    marketProfilePreset: persistedPresetChoice(confirmInput) as CheckoutOrderPayload["marketProfilePreset"],
    specialization: confirmInput.specialization ?? null,
    includeKeywords: [...(confirmInput.includeKeywords ?? [])],
    industries: [...(confirmInput.industries ?? [])],
    roles: [...(confirmInput.roles ?? [])],
  });
  const raw = JSON.parse(JSON.stringify(merged)) as Record<string, unknown>;
  return { raw, order: mapCheckoutOrderRow(buildOrderRow(raw)) };
}

/** The real picker SSR'd by the real React; returns the single checked radio value. */
function renderCheckedPresetRadio(selectedPresetId: string | null): string {
  const html = renderToStaticMarkup(
    react.createElement(MarketProfilePresetPicker, {
      presets: marketProfilePresets.MARKET_PROFILE_PRESETS,
      selectedPresetId,
    }),
  );
  const checked = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)]
    .filter((tag) => tag[0].includes("checked"))
    .map((tag) => /value="([^"]+)"/.exec(tag[0])?.[1])
    .filter((value): value is string => typeof value === "string");
  if (checked.length !== 1) {
    throw new Error(
      `expected exactly one checked preset radio, got: ${JSON.stringify(checked)}`,
    );
  }
  return checked[0];
}

// ---------------------------------------------------------------------------
// Action submissions (QA run959 scenario matrix).
// ---------------------------------------------------------------------------

function customSubmission(
  specialization: string,
  variant: "edited-fields" | "empty-fields",
): FormData {
  const formData = new FormData();
  formData.set("orderId", "o1");
  formData.set("agencyName", "Roundtrip QA");
  formData.set("marketProfilePreset", "custom");
  formData.set("specialization", specialization);
  if (variant === "edited-fields") {
    formData.set("includeKeywords", "своя фраза");
    formData.append("roles", "sales");
  }
  return formData;
}

function resubmissionFromPersisted(
  first: ConfirmInput,
  checkedRadio: string,
): FormData {
  const formData = new FormData();
  formData.set("orderId", "o1");
  formData.set("agencyName", "Roundtrip QA");
  formData.set("marketProfilePreset", checkedRadio);
  if (first.specialization != null) {
    formData.set("specialization", first.specialization);
  }
  const keywords = [...(first.includeKeywords ?? [])];
  if (keywords.length > 0) {
    formData.set("includeKeywords", keywords.join("\n"));
  }
  for (const role of first.roles ?? []) {
    formData.append("roles", role);
  }
  for (const industry of first.industries ?? []) {
    formData.append("industries", industry);
  }
  return formData;
}

async function captureConfirm(formData: FormData): Promise<ConfirmInput> {
  mockConfirm.mockClear();
  await confirmPilotProfileAction("o1", formData);
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  return mockConfirm.mock.calls[0][0];
}

const SCENARIOS = [
  { label: "engineering", specialization: "Инженерный подбор" },
  { label: "finance", specialization: "Финансовый софт" },
] as const;

const VARIANTS = ["edited-fields", "empty-fields"] as const;

describe("F-1 regression — explicit custom market-profile round-trip (PR260 run959)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({
      workspaceId: "9",
      dataOwnerId: "42",
    } as never);
    mockConfirm.mockResolvedValue({} as never);
  });

  for (const scenario of SCENARIOS) {
    for (const variant of VARIANTS) {
      it(`«${scenario.specialization}» / ${variant}: the custom choice and the manual criteria survive save → reload → resubmit`, async () => {
        // 1. Explicit «Свой профиль» save while the specialization keeps a
        //    preset-like label and the manual criteria are edited or empty.
        const first = await captureConfirm(
          customSubmission(scenario.specialization, variant),
        );

        // 2. Reload through the real merge → JSONB → normalize pipeline.
        const firstPersist = persistConfirm({}, first);

        // 3. The page re-selection stays custom — the recorded explicit choice
        //    is never re-resolved through the specialization label.
        const selection = pageSelectedPresetId(firstPersist.order, {
          specialization: first.specialization ?? null,
        });
        expect(selection).toBeNull();

        // 4. The real picker SSR checks «Свой профиль», not the label-matched preset.
        const checkedRadio = renderCheckedPresetRadio(selection);
        expect(checkedRadio).toBe("custom");

        // 5. Resubmit exactly what the rendered form submits: the second save
        //    must not refill the manual criteria from any preset.
        const second = await captureConfirm(
          resubmissionFromPersisted(first, checkedRadio),
        );
        expect(second.roles).toEqual(first.roles);
        expect(second.includeKeywords).toEqual(first.includeKeywords);
        expect(second.industries).toEqual(first.industries);
        expect(second.specialization).toBe(first.specialization);

        // 6. The round-trip is idempotent: still custom after the second save.
        const secondPersist = persistConfirm(firstPersist.raw, second);
        expect(
          pageSelectedPresetId(secondPersist.order, {
            specialization: second.specialization ?? null,
          }),
        ).toBeNull();
      });
    }
  }

  it("records the explicit custom choice in the JSONB payload as a selection distinguishable from legacy absence", async () => {
    const first = await captureConfirm(
      customSubmission("Инженерный подбор", "empty-fields"),
    );
    const { order } = persistConfirm({}, first);
    const legacyOrder = mapCheckoutOrderRow(
      buildOrderRow({ specialization: "Инженерный подбор" }),
    );
    // A legacy order has NO recorded choice; an explicit «Свой профиль» must
    // stay distinguishable from that after normalization.
    expect(order.payload.marketProfilePreset).not.toBe(
      legacyOrder.payload.marketProfilePreset,
    );
    expect(order.payload.marketProfilePreset).toBe("custom");
  });

  it("true legacy payload without a recorded choice keeps the specialization-label fallback", () => {
    const legacy = mapCheckoutOrderRow(
      buildOrderRow({ specialization: "Инженерный подбор" }),
    );
    expect(
      pageSelectedPresetId(legacy, { specialization: "Инженерный подбор" }),
    ).toBe("engineering-hiring");
  });

  it("an unrelated payload update never turns a legacy order into an explicit custom choice", () => {
    const legacy = mapCheckoutOrderRow(
      buildOrderRow({ specialization: "Финансовый софт" }),
    );
    const merged = mergeCheckoutOrderPayload(legacy.payload, {
      onboardingStep: "preview",
    });
    const reloaded = mapCheckoutOrderRow(
      buildOrderRow(JSON.parse(JSON.stringify(merged))),
    );
    expect(
      pageSelectedPresetId(reloaded, { specialization: "Финансовый софт" }),
    ).toBe("finance-software");
  });

  it("preset choice round-trip stays correct: the recorded id re-selects the preset and empty-only fills still apply", async () => {
    const formData = new FormData();
    formData.set("orderId", "o1");
    formData.set("agencyName", "Roundtrip QA");
    formData.set("marketProfilePreset", "engineering-hiring");
    const first = await captureConfirm(formData);
    const { order } = persistConfirm({}, first);

    const selection = pageSelectedPresetId(order, {
      specialization: first.specialization ?? null,
    });
    expect(selection).toBe("engineering-hiring");
    expect(renderCheckedPresetRadio(selection)).toBe("engineering-hiring");

    const preset = marketProfilePresets.getMarketProfilePresetById(
      "engineering-hiring",
    );
    if (!preset) throw new Error("registry lost engineering-hiring");
    expect(first.roles).toEqual([...preset.criteria.roles]);
    expect(first.includeKeywords).toEqual([...preset.criteria.demandSignals]);
    expect(first.specialization).toBe(preset.criteria.specialization);
  });
});
