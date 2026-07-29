import { isAuthPlatformV2EnabledForUser } from "./config";
import { readAuthV2SessionCookie } from "./session-cookie";
import { readAuthSession, type AuthSession } from "./sessions";

export async function readCurrentAuthSession(
  options: { requireWorkspace?: boolean } = {},
): Promise<AuthSession | null> {
  const token = await readAuthV2SessionCookie().catch(() => null);
  if (!token) return null;

  const session = await readAuthSession(token);
  if (
    !session
    || !isAuthPlatformV2EnabledForUser(session.userId)
    || (options.requireWorkspace === true && !session.workspaceId)
  ) {
    return null;
  }
  return session;
}
