/** @jest-environment node */

import { getPool } from "@/lib/db-pool";
import {
  LANDING_PRODUCT_PROOF_QUERY,
  getLandingProductProof,
} from "@/lib/landing-product-proof";

jest.mock("@/lib/db-pool", () => ({
  getPool: jest.fn(),
}));

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

describe("landing product proof", () => {
  it("maps only anonymous aggregate PostgreSQL metrics with a bounded query timeout", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{
        companies_with_hiring_signals_7d: "41",
        confirmed_hiring_signals_7d: "73",
        companies_passing_confidence_gate_7d: "18",
        last_successful_recalculation_at: "2026-07-26T06:30:00.000Z",
      }],
    });
    mockGetPool.mockReturnValue({ query } as never);

    await expect(getLandingProductProof()).resolves.toEqual({
      companiesWithHiringSignals7d: 41,
      confirmedHiringSignals7d: 73,
      companiesPassingConfidenceGate7d: 18,
      lastSuccessfulRecalculationAt: "2026-07-26T06:30:00.000Z",
    });
    expect(query).toHaveBeenCalledWith(LANDING_PRODUCT_PROOF_QUERY);
  });

  it("returns null instead of fabricated zeros when PostgreSQL is unavailable", async () => {
    mockGetPool.mockReturnValue({
      query: jest.fn().mockRejectedValue(new Error("database unavailable")),
    } as never);

    await expect(getLandingProductProof()).resolves.toBeNull();
  });

  it("returns null when there is no successful recalculation to substantiate the proof", async () => {
    mockGetPool.mockReturnValue({
      query: jest.fn().mockResolvedValue({
        rows: [{
          companies_with_hiring_signals_7d: "0",
          confirmed_hiring_signals_7d: "0",
          companies_passing_confidence_gate_7d: "0",
          last_successful_recalculation_at: null,
        }],
      }),
    } as never);

    await expect(getLandingProductProof()).resolves.toBeNull();
  });

  it("returns null when the aggregate query exceeds the server-render budget", async () => {
    jest.useFakeTimers();
    mockGetPool.mockReturnValue({
      query: jest.fn().mockReturnValue(new Promise(() => undefined)),
    } as never);

    const proof = getLandingProductProof({ timeoutMs: 25 });
    await jest.advanceTimersByTimeAsync(25);
    await expect(proof).resolves.toBeNull();

    jest.useRealTimers();
  });
});
