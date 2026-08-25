import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth-v2/authorization";
import { isAuthSameOriginRequest } from "@/lib/auth-v2/security";
import { activateVerifiedTrial } from "@/lib/trial";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthSameOriginRequest(request)) {
    return json({ error: "forbidden" }, 403);
  }

  const authorization = await getSession({ permission: "profiles:write" });
  if (
    !authorization
    || authorization.mode === "legacy"
    || !authorization.workspaceId
  ) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const result = await activateVerifiedTrial({
      userId: authorization.userId,
      workspaceId: authorization.workspaceId,
    });

    if (result.status === "activated") {
      return json(result, 201);
    }
    if (result.status === "already_claimed") {
      return json({ error: result.status, reason: result.reason }, 409);
    }
    return json({ error: result.status, reason: result.reason }, 403);
  } catch {
    return json({ error: "trial_unavailable" }, 503);
  }
}

function json(body: Record<string, unknown>, status: number): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
