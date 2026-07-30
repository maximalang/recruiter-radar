import { NextResponse } from "next/server";

import {
  isAuthV2SessionReadEnabledForUser,
} from "@/lib/auth-v2/config";
import { exchangeLegacyOwnerSession } from "@/lib/auth-v2/legacy-session";
import {
  readAuthV2SessionCookie,
  writeAuthV2SessionCookie,
} from "@/lib/auth-v2/session-cookie";
import {
  readAuthSession,
  rotateAuthSession,
} from "@/lib/auth-v2/sessions";
import { isAuthSameOriginRequest } from "@/lib/auth-v2/security";
import {
  clearLegacyOwnerSession,
  readLegacyOwnerSessionCookie,
} from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const ROTATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ROTATION_REFRESH_LEAD_MS = 5 * 60 * 1000;

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthSameOriginRequest(request)) {
    return NextResponse.json({ ok: false }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const token = await readAuthV2SessionCookie().catch(() => null);
  if (token) {
    const session = await readAuthSession(token);
    if (
      session
      && isAuthV2SessionReadEnabledForUser(session.userId)
    ) {
      const refreshBeforeCutoff = (
        session.rotatedAt instanceof Date
        && session.rotatedAt.getTime()
          <= Date.now() - (ROTATION_INTERVAL_MS - ROTATION_REFRESH_LEAD_MS)
      );
      if (session.rotationDue || refreshBeforeCutoff) {
        const rotated = session.rotationDue
          ? await rotateAuthSession(token)
          : await rotateAuthSession(token, new Date(), { force: true });
        if (rotated) await writeAuthV2SessionCookie(rotated.token);
        return noStore({ ok: true, rotated: Boolean(rotated), migrated: false });
      }
      return noStore({ ok: true, rotated: false, migrated: false });
    }
  }

  const legacyToken = await readLegacyOwnerSessionCookie();
  if (legacyToken) {
    const exchanged = await exchangeLegacyOwnerSession({ legacyToken });
    if (exchanged) {
      await writeAuthV2SessionCookie(exchanged.token);
      await clearLegacyOwnerSession();
      return noStore({ ok: true, rotated: false, migrated: true });
    }
  }

  return noStore({ ok: true, rotated: false, migrated: false });
}

function noStore(body: {
  ok: true;
  rotated: boolean;
  migrated: boolean;
}): NextResponse {
  const response = NextResponse.json(body);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
