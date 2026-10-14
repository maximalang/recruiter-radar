/**
 * Regression coverage for PR #198 finding F-1: the Better Auth identity route
 * must contain an asynchronously failing adapter as Response 503/no-store.
 *
 * The real adapter (lib/better-auth/auth) is replaced with a synthetic mock,
 * so these tests never touch a database, the network, or production
 * configuration. The adapter failure mode is selected with the test-only
 * RR_TEST_ADAPTER_MODE variable (ok | sync-error | async-error).
 */
import {
  GET as identityGet,
  POST as identityPost,
} from "@/app/api/identity/[...all]/route";

const originalEnabled = process.env.BETTER_AUTH_ENABLED;
const originalAdapterMode = process.env.RR_TEST_ADAPTER_MODE;

jest.mock("@/lib/better-auth/auth", () => ({
  auth: {
    handler: () => {
      const mode = process.env.RR_TEST_ADAPTER_MODE ?? "ok";
      if (mode === "sync-error") {
        throw new Error("synthetic synchronous fault");
      }
      if (mode === "async-error") {
        return Promise.reject(new Error("synthetic asynchronous fault"));
      }
      return new Response("ok", {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    },
  },
}));

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("Better Auth adapter failure containment", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_ENABLED = "true";
    delete process.env.RR_TEST_ADAPTER_MODE;
  });

  afterAll(() => {
    restore("BETTER_AUTH_ENABLED", originalEnabled);
    restore("RR_TEST_ADAPTER_MODE", originalAdapterMode);
  });

  it("passes a successful adapter response through for GET", async () => {
    const response = await identityGet(
      new Request("https://recruiter-radar.ru/api/identity/session"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("ok");
  });

  it("contains a synchronous adapter throw as 503 no-store for GET", async () => {
    process.env.RR_TEST_ADAPTER_MODE = "sync-error";
    const response = await identityGet(
      new Request("https://recruiter-radar.ru/api/identity/session"),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("contains a rejected adapter promise as 503 no-store for GET", async () => {
    process.env.RR_TEST_ADAPTER_MODE = "async-error";
    const response = await identityGet(
      new Request("https://recruiter-radar.ru/api/identity/session"),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("contains a rejected adapter promise as 503 no-store for POST", async () => {
    process.env.RR_TEST_ADAPTER_MODE = "async-error";
    const response = await identityPost(
      new Request("https://recruiter-radar.ru/api/identity/sign-in", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });
});

describe("Better Auth adapter import failure containment", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_ENABLED = "true";
  });

  afterAll(() => {
    restore("BETTER_AUTH_ENABLED", originalEnabled);
    jest.resetModules();
  });

  it("contains an adapter import failure as 503 no-store", async () => {
    jest.resetModules();
    jest.doMock("@/lib/better-auth/auth", () => {
      throw new Error("synthetic import fault");
    });
    const route = await import("@/app/api/identity/[...all]/route");
    const response = await route.GET(
      new Request("https://recruiter-radar.ru/api/identity/session"),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });
});
