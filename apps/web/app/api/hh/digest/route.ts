import { NextResponse } from "next/server";

import { hasPremiumEntitlement } from "../../../../lib/db";
import { getHhDigestItems } from "../../../../lib/hhDigest";
import { logError, logEvent } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const digestApiKey = process.env.DIGEST_API_KEY;

  if (!digestApiKey) {
    return NextResponse.json(
      {
        error: "DIGEST_API_KEY is not configured."
      },
      {
        status: 500
      }
    );
  }

  const providedApiKey = request.headers.get("x-api-key");

  if (providedApiKey !== digestApiKey) {
    return NextResponse.json(
      {
        error: "Invalid or missing x-api-key header."
      },
      {
        status: 401
      }
    );
  }

  const rawUserId = request.headers.get("x-user-id");
  if (rawUserId) {
    const userId = Number(rawUserId);
    if (Number.isInteger(userId) && userId > 0) {
      const entitlement = await hasPremiumEntitlement(userId);
      if (!entitlement.allowed) {
        return NextResponse.json({ error: entitlement.reason ?? "Entitlement required." }, { status: 403 });
      }
    }
  }

  try {
    const items = await getHhDigestItems();
    logEvent("hh.digest.loaded", { items: items.length });
    return NextResponse.json({ items });
  } catch (error) {
    logError("hh.digest.failed", error);
    const message = error instanceof Error ? error.message : "Failed to load HH digest.";

    return NextResponse.json(
      {
        error: message
      },
      {
        status: 500
      }
    );
  }
}
