import { NextResponse } from "next/server";

import { getHhDigestItems } from "../../../../lib/hhDigest";
import { hasClientProfilePremiumEntitlement } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function resolveClientProfileId(request: Request): string | null {
  const { searchParams } = new URL(request.url);
  const clientProfileId = searchParams.get("clientProfileId")?.trim();
  const fallbackClientProfileId = process.env.DAILY_DIGEST_CLIENT_PROFILE_ID?.trim();

  return clientProfileId || fallbackClientProfileId || null;
}

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

  const clientProfileId = resolveClientProfileId(request);

  if (!clientProfileId) {
    return NextResponse.json(
      {
        error: "clientProfileId is required. Set ?clientProfileId=... or DAILY_DIGEST_CLIENT_PROFILE_ID."
      },
      {
        status: 400
      }
    );
  }

  try {
    const entitlement = await hasClientProfilePremiumEntitlement(clientProfileId);

    if (!entitlement.allowed) {
      return NextResponse.json(
        { error: entitlement.reason ?? "Premium entitlement is required for digest." },
        { status: 403 }
      );
    }

    const items = await getHhDigestItems({ clientProfileId });
    return NextResponse.json({ clientProfileId, items });
  } catch (error) {
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
