import {
  GET as identityGet,
  POST as identityPost,
} from "@/app/api/identity/[...all]/route";

const originalEnabled = process.env.BETTER_AUTH_ENABLED;

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("Better Auth public boundary", () => {
  beforeEach(() => {
    delete process.env.BETTER_AUTH_ENABLED;
  });

  afterAll(() => {
    restore("BETTER_AUTH_ENABLED", originalEnabled);
  });

  it("returns 404 for GET while the identity foundation is disabled", async () => {
    const response = await identityGet(new Request("https://recruiter-radar.ru/api/identity/session"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 404 for POST while the identity foundation is disabled", async () => {
    const response = await identityPost(new Request("https://recruiter-radar.ru/api/identity/sign-in", {
      method: "POST",
    }));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
