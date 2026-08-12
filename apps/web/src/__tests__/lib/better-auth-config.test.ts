describe("Better Auth runtime policy", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.BETTER_AUTH_ENABLED;
    delete process.env.BETTER_AUTH_MCP_OAUTH_ENABLED;
    delete process.env.BETTER_AUTH_MCP_DCR_ENABLED;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;
    process.env.NODE_ENV = "test";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("is fail-dark by default", async () => {
    const config = await import("../../../lib/better-auth/config");
    expect(config.getBetterAuthPublicState()).toMatchObject({
      enabled: false,
      mcpOAuthEnabled: false,
      mcpDcrEnabled: false,
      basePath: "/api/identity",
      mcpResource: "https://recruiter-radar.ru/api/internal/mcp",
    });
  });

  it("does not enable MCP or DCR without their parent gates", async () => {
    process.env.BETTER_AUTH_MCP_OAUTH_ENABLED = "true";
    process.env.BETTER_AUTH_MCP_DCR_ENABLED = "true";
    const config = await import("../../../lib/better-auth/config");
    expect(config.isBetterAuthMcpEnabled()).toBe(false);
    expect(config.isBetterAuthMcpDcrEnabled()).toBe(false);
  });

  it("exposes only read capability to the first MCP rollout", async () => {
    const config = await import("../../../lib/better-auth/config");
    expect(config.BETTER_AUTH_CORE_SCOPES).toEqual([
      "openid",
      "profile",
      "email",
      "offline_access",
      "rr.operator.read",
    ]);
    expect(config.BETTER_AUTH_CORE_SCOPES).not.toContain("rr.operator.restart");
    expect(config.BETTER_AUTH_CORE_SCOPES).not.toContain("rr.operator.proxy");
    expect(config.BETTER_AUTH_CORE_SCOPES).not.toContain("rr.operator.deploy");
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
