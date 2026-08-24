jest.mock("@/lib/lead-discovery/query-planner-v2-yield-job", () => ({
  materializeQueryPlannerV2YieldJob: jest.fn(),
}));
jest.mock("@/lib/opportunities/commercial-signal-enrichment-job", () => ({
  runCommercialSignalEnrichmentJob: jest.fn(),
}));
jest.mock("@/lib/runtime", () => ({
  logError: jest.fn(),
}));

import { POST as queryPlanYieldPost } from "@/app/api/cron/opportunities/query-plan-yield/route";
import { POST as commercialSignalEnrichmentPost } from "@/app/api/cron/opportunities/commercial-signal-enrichment/route";

const originalCronApiKey = process.env.CRON_API_KEY;

describe("opportunity cron configuration security", () => {
  beforeEach(() => {
    delete process.env.CRON_API_KEY;
  });

  afterAll(() => {
    if (originalCronApiKey === undefined) {
      delete process.env.CRON_API_KEY;
    } else {
      process.env.CRON_API_KEY = originalCronApiKey;
    }
  });

  test("Query Plan yield does not expose the cron credential name", async () => {
    const response = await queryPlanYieldPost(requestFor("query-plan-yield"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      success: false,
      error: "Query Plan yield service is not configured.",
    });
    expect(JSON.stringify(body)).not.toContain("CRON_API_KEY");
  });

  test("Commercial Signal enrichment does not expose the cron credential name", async () => {
    const response = await commercialSignalEnrichmentPost(requestFor("commercial-signal-enrichment"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      success: false,
      error: "Commercial Signal enrichment service is not configured.",
    });
    expect(JSON.stringify(body)).not.toContain("CRON_API_KEY");
  });
});

function requestFor(route: string) {
  return new Request(`http://localhost/api/cron/opportunities/${route}`, {
    method: "POST",
  }) as never;
}
