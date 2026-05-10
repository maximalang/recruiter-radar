import { NextResponse } from "next/server";

import { runDigestForClientProfile } from "../../../lib/digest";
import { hasClientProfilePremiumEntitlement } from "../../../lib/db";

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

  const { searchParams } = new URL(request.url);
  const clientProfileId = searchParams.get("clientProfileId");

  if (!clientProfileId) {
    return NextResponse.json(
      {
        error: "clientProfileId is required."
      },
      {
        status: 400
      }
    );
  }

  const entitlement = await hasClientProfilePremiumEntitlement(clientProfileId);

  if (!entitlement.allowed) {
    return NextResponse.json({ error: entitlement.reason ?? "Premium entitlement is required." }, { status: 403 });
  }

  const limitParam = searchParams.get("limit");
  const cooldownDaysParam = searchParams.get("cooldownDays");
  const sourceKey = searchParams.get("sourceKey");

  try {
    const result = await runDigestForClientProfile({
      clientProfileId,
      sourceKey,
      limit: limitParam ? Number(limitParam) : undefined,
      cooldownDays: cooldownDaysParam ? Number(cooldownDaysParam) : undefined
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run digest.";

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
