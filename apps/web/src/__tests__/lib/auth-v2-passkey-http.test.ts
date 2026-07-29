import { readLimitedJsonObject } from "@/lib/auth-v2/passkey-http";

function request(body: string, contentLength?: string): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (contentLength !== undefined) headers.set("Content-Length", contentLength);
  return new Request("https://radar.example/api/auth/passkeys/test", {
    method: "POST",
    headers,
    body,
  });
}

describe("auth v2 passkey JSON boundary", () => {
  test("accepts only a JSON object within the configured byte limit", async () => {
    await expect(readLimitedJsonObject(request('{"name":"key"}'), 32))
      .resolves.toEqual({ name: "key" });
    await expect(readLimitedJsonObject(request("[]"), 32)).resolves.toBeNull();
    await expect(readLimitedJsonObject(request("null"), 32)).resolves.toBeNull();
    await expect(readLimitedJsonObject(request("{"), 32)).resolves.toBeNull();
  });

  test("rejects declared or streamed bodies above the byte limit", async () => {
    await expect(readLimitedJsonObject(
      request('{"ok":true}', "4096"),
      32,
    )).resolves.toBeNull();
    await expect(readLimitedJsonObject(
      request(`{"value":"${"x".repeat(64)}"}`),
      32,
    )).resolves.toBeNull();
  });

  test("fails closed on an invalid byte limit or content length", async () => {
    await expect(readLimitedJsonObject(request("{}"), 0)).resolves.toBeNull();
    await expect(readLimitedJsonObject(
      request("{}", "not-a-number"),
      32,
    )).resolves.toBeNull();
  });
});
