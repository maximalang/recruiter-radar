import { GET as identityGet } from "@/app/api/identity/[...all]/route";
import { GET as metadataGet } from "@/app/.well-known/oauth-authorization-server/api/identity/route";

const originalEnabled = process.env.BETTER_AUTH_ENABLED;
const originalMcpEnabled = process.env.BETTER_AUTH_MCP_OAUTH_ENABLED;
const originalDcrEnabled = process.env.BETTER_AUTH_MCP_DCR_ENABLED;

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("Better Auth public boundary", () => {
  beforeEach(() => {
    delete process.env.BETTER_AUTH_ENABLED;
    delete process.env.BETTER_AUTH_MCP_OAUTH_ENABLED;
    delete process.env.BETTER_AUTH_MCP_DCR_ENABLED;
  });

  afterAll(() => {
    restore("BETTER_AUTH_ENABLED", originalEnabled);
    restore("BETTER_AUTH_MCP_OAUTH_ENABLED", originalMcpEnabled);
    restore("BETTER_AUTH_MCP_DCR_ENABLED", originalDcrEnabled);
  });

  it("returns 404 for the identity handler while disabled", async () => {
    const response = await identityGet(new Request("https://recruiter-radar.ru/api/identity/session"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 404 for OAuth metadata while MCP OAuth is disabled", async () => {
    const response = await metadataGet(
      new Request("https://recruiter-radar.ru/.well-known/oauth-authorization-server/api/identity"),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not let the MCP child flag bypass the Better Auth parent gate", async () => {
    process.env.BETTER_AUTH_MCP_OAUTH_ENABLED = "true";
    const response = await metadataGet(
      new Request("https://recruiter-radar.ru/.well-known/oauth-authorization-server/api/identity"),
    );
    expect(response.status).toBe(404);
  });
});
