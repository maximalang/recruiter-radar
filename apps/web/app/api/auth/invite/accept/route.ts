import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import {
  clearPendingAuthActionToken,
  readPendingAuthActionToken,
} from "@/lib/auth-v2/pending-action-cookie";
import { authActionJson } from "@/lib/auth-v2/pending-action-http";
import {
  readAuthV2SessionCookie,
  writeAuthV2SessionCookie,
} from "@/lib/auth-v2/session-cookie";
import { isAuthSameOriginRequest } from "@/lib/auth-v2/security";
import { changeActiveWorkspace } from "@/lib/auth-v2/sessions";
import { acceptWorkspaceInvite } from "@/lib/auth-v2/workspace-team";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthSameOriginRequest(request)) {
    return authActionJson({ ok: false }, 403);
  }
  const token = await readPendingAuthActionToken("workspace_invite");
  if (!token) return authActionJson({ ok: false, code: "invalid" }, 400);

  const session = await readCurrentAuthSession();
  if (!session) {
    return authActionJson({
      ok: false,
      loginUrl: "/login?returnTo=/auth/invite",
    }, 401);
  }

  const accepted = await acceptWorkspaceInvite({ token, session });
  if (!accepted.ok) {
    if (accepted.code !== "unavailable") {
      await clearPendingAuthActionToken("workspace_invite");
    }
    return authActionJson(
      { ok: false, code: accepted.code },
      accepted.code === "email_mismatch"
        ? 403
        : accepted.code === "conflict"
          ? 409
          : accepted.code === "unavailable"
            ? 503
            : 400,
    );
  }

  await clearPendingAuthActionToken("workspace_invite");
  const sessionToken = await readAuthV2SessionCookie();
  const switched = sessionToken
    ? await changeActiveWorkspace({
      token: sessionToken,
      workspaceId: accepted.workspaceId,
    })
    : null;
  if (switched) {
    await writeAuthV2SessionCookie(switched.token);
  }
  return authActionJson({
    ok: true,
    destination: switched
      ? "/dashboard?invite=accepted"
      : "/settings?invite=accepted",
  });
}
