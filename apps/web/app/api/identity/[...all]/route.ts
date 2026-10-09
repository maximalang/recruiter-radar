import { isBetterAuthEnabled } from "../../../../lib/better-auth/config";

async function dispatch(request: Request): Promise<Response> {
  if (!isBetterAuthEnabled()) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const { auth } = await import("../../../../lib/better-auth/auth");
    return auth.handler(request);
  } catch {
    return new Response(null, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export const GET = dispatch;
export const POST = dispatch;
