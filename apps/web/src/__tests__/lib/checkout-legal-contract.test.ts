import { validateCheckoutOrderForm } from "@/lib/checkout-legal";

function buildFormData(overrides: Record<string, string | null> = {}): FormData {
  const values: Record<string, string> = {
    agencyName: "Northstar Recruiting",
    payerType: "business",
    buyerInn: "7701234567",
    acceptTerms: "on",
    acceptPersonalData: "on",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete values[key];
    else values[key] = value;
  }
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.append(key, value);
  return formData;
}

describe("checkout legal contract (server-side)", () => {
  it("accepts a fully valid business order", () => {
    const decision = validateCheckoutOrderForm(buildFormData());
    expect(decision).toEqual({ ok: true, payerType: "business", buyerInn: "7701234567" });
  });

  it("accepts an individual payer without INN", () => {
    const decision = validateCheckoutOrderForm(buildFormData({ payerType: "individual", buyerInn: "" }));
    expect(decision).toEqual({ ok: true, payerType: "individual", buyerInn: null });
  });

  it("rejects when the offer checkbox is missing even if browser validation is bypassed", () => {
    const decision = validateCheckoutOrderForm(buildFormData({ acceptTerms: null }));
    expect(decision).toEqual({ ok: false, errorCode: "legal" });
  });

  it("rejects when the personal-data consent checkbox is missing", () => {
    const decision = validateCheckoutOrderForm(buildFormData({ acceptPersonalData: "off" }));
    expect(decision).toEqual({ ok: false, errorCode: "legal" });
  });

  it("treats any non-'on' checkbox value as missing acceptance", () => {
    const decision = validateCheckoutOrderForm(buildFormData({ acceptTerms: "1", acceptPersonalData: "yes" }));
    expect(decision).toEqual({ ok: false, errorCode: "legal" });
  });

  it("rejects a blank or oversized agency name first", () => {
    expect(validateCheckoutOrderForm(buildFormData({ agencyName: "   " }))).toEqual({ ok: false, errorCode: "agency" });
    expect(validateCheckoutOrderForm(buildFormData({ agencyName: "a".repeat(161) }))).toEqual({ ok: false, errorCode: "agency" });
  });

  it("rejects invalid buyer INN for business payers", () => {
    expect(validateCheckoutOrderForm(buildFormData({ buyerInn: "123" }))).toEqual({ ok: false, errorCode: "inn" });
    expect(validateCheckoutOrderForm(buildFormData({ buyerInn: "abcd" }))).toEqual({ ok: false, errorCode: "inn" });
  });

  it("defaults to business payer and then requires a valid INN when the radio is absent", () => {
    const decision = validateCheckoutOrderForm(buildFormData({ payerType: null, buyerInn: "" }));
    expect(decision).toEqual({ ok: false, errorCode: "inn" });
  });

  it("validation order matches the redirect contract: agency → inn → legal", () => {
    const formData = buildFormData({ agencyName: "", buyerInn: "", acceptTerms: null, acceptPersonalData: null });
    expect(validateCheckoutOrderForm(formData)).toEqual({ ok: false, errorCode: "agency" });
  });
});
