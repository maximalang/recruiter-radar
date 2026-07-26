import { renderToStaticMarkup } from "react-dom/server";

import LandingProductProof from "@/app/landing-product-proof";
import { getLandingProductProof } from "@/lib/landing-product-proof";

jest.mock("@/lib/landing-product-proof", () => ({
  getLandingProductProof: jest.fn(),
}));

const mockGetLandingProductProof = getLandingProductProof as jest.MockedFunction<
  typeof getLandingProductProof
>;

describe("LandingProductProof", () => {
  it("renders anonymous, clearly named real-product metrics", async () => {
    mockGetLandingProductProof.mockResolvedValue({
      companiesWithHiringSignals7d: 41,
      confirmedHiringSignals7d: 73,
      companiesPassingConfidenceGate7d: 18,
      lastSuccessfulRecalculationAt: "2026-07-26T06:30:00.000Z",
    });

    const component = await LandingProductProof();
    const markup = renderToStaticMarkup(component!);

    expect(markup).toContain("Что радар проверяет сейчас");
    expect(markup).toContain("Компаний с сигналами найма за 7 дней");
    expect(markup).toContain("Подтверждённых сигналов найма");
    expect(markup).toContain("Компаний, прошедших уровень доверия A/B");
    expect(markup).toContain("Последний успешный пересчёт");
    expect(markup).not.toContain("клиент");
    expect(markup).not.toContain("email");
  });

  it("renders nothing when aggregate data is unavailable", async () => {
    mockGetLandingProductProof.mockResolvedValue(null);

    await expect(LandingProductProof()).resolves.toBeNull();
  });
});
