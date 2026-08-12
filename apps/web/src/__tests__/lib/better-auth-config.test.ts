describe("Better Auth runtime policy", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.BETTER_AUTH_ENABLED;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("is fail-dark by default", async () => {
    const config = await import("../../../lib/better-auth/config");
    expect(config.getBetterAuthPublicState()).toEqual({
      enabled: false,
      basePath: "/api/identity",
    });
  });

  it("requires a dedicated strong secret when runtime is activated", async () => {
    process.env.BETTER_AUTH_ENABLED = "true";
    process.env.DATABASE_URL = "postgres://example.invalid/rr";
    process.env.BETTER_AUTH_SECRET = "too-short";
    const config = await import("../../../lib/better-auth/config");
    expect(() => config.getBetterAuthRuntimeConfig()).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("rejects an insecure non-local origin", async () => {
    process.env.BETTER_AUTH_URL = "http://recruiter-radar.ru";
    const config = await import("../../../lib/better-auth/config");
    expect(() => config.getBetterAuthBaseOrigin()).toThrow(/HTTPS/);
  });
});
