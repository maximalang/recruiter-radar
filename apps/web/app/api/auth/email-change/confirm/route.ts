import { confirmAccountEmailChange } from "@/lib/auth-v2/account-security";
import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import {
  clearPendingAuthActionToken,
  readPendingAuthActionToken,
} from "@/lib/auth-v2/pending-action-cookie";
import { authActionJson } from "@/lib/auth-v2/pending-action-http";
import { isAuthSameOriginRequest } from "@/lib/auth-v2/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthSameOriginRequest(request)) {
    return authActionJson({ ok: false }, 403);
  }
  const token = await readPendingAuthActionToken("email_change");
  if (!token) return authActionJson({ ok: false, code: "invalid" }, 400);

  const currentSession = await readCurrentAuthSession();
  const result = await confirmAccountEmailChange({
    token,
    currentSession,
  });
  if (result.ok) {
    await clearPendingAuthActionToken("email_change");
    return authActionJson({
      ok: true,
      destination: result.preservedCurrentSession
        ? "/settings/security?email=changed"
        : "/login?email=changed",
    });
  }
  if (result.code !== "unavailable") {
    await clearPendingAuthActionToken("email_change");
  }
  return authActionJson(
    { ok: false, code: result.code },
    result.code === "conflict"
      ? 409
      : result.code === "unavailable"
        ? 503
        : 400,
  );
}
