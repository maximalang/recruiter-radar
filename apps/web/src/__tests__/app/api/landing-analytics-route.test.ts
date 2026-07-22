import { POST } from "@/app/api/analytics/landing/route";

describe("POST /api/analytics/landing", () => {
  it("accepts only the provider-neutral event envelope", async () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(new Request("http://localhost/api/analytics/landing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "preview_started", context: "form" }),
    }));

    expect(response.status).toBe(204);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"event":"landing_analytics_event"'));
    info.mockRestore();
  });

  it("rejects profile fields and unknown conversion names", async () => {
    const withProfile = await POST(new Request("http://localhost/api/analytics/landing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "preview_started", context: "form", specialization: "engineering" }),
    }));
    const unknown = await POST(new Request("http://localhost/api/analytics/landing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "lead_purchased", context: "landing" }),
    }));

    expect(withProfile.status).toBe(400);
    expect(unknown.status).toBe(400);
  });

  it("accepts an FAQ open without sending question copy", async () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(new Request("http://localhost/api/analytics/landing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "faq_opened", context: "faq-3" }),
    }));

    expect(response.status).toBe(204);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"name":"faq_opened"'));
    info.mockRestore();
  });
});
