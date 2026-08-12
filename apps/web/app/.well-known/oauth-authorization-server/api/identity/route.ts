import { isBetterAuthMcpEnabled } from "../../../../../lib/better-auth/config";

export async function GET(): Promise<Response> {
  if (!isBetterAuthMcpEnabled()) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const [{ oauthProviderAuthServerMetadata }, { auth }] = await Promise.all([
      import("@better-auth/oauth-provider"),
      import("../../../../../lib/better-auth/auth"),
    ]);
    return oauthProviderAuthServerMetadata(auth)();
  } catch {
    return new Response(null, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
