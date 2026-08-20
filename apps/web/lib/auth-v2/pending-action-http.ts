import { NextResponse } from "next/server";

import { readBoundedRequestText } from "@/lib/http/read-bounded-request-text";
import {
  writePendingAuthActionToken,
  type PendingAuthAction,
} from "./pending-action-cookie";
import { isAuthSameOriginRequest } from "./security";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const MAX_BODY_BYTES = 512;

export async function preparePendingAuthAction(
  request: Request,
  action: PendingAuthAction,
): Promise<NextResponse> {
  if (!isAuthSameOriginRequest(request)) {
    return json({ ok: false }, 403);
  }

  const rawBody = await readBoundedRequestText(request, MAX_BODY_BYTES).catch(() => null);
  if (rawBody === null) {
    return json({ ok: false }, 400);
  }
  const body = (() => {
    try {
      return JSON.parse(rawBody) as { token?: unknown };
    } catch {
      return null;
    }
  })();
  if (
    !body
    || typeof body.token !== "string"
    || !TOKEN_PATTERN.test(body.token)
  ) {
    return json({ ok: false }, 400);
  }
  await writePendingAuthActionToken(action, body.token);
  return json({ ok: true }, 200);
}

export function authActionJson(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return json(body, status);
}

function json(body: Record<string, unknown>, status: number): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
