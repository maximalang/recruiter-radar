import { NextResponse } from "next/server";

import { getHhDigestItems } from "../../../../lib/hhDigest";

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

  try {
    const items = await getHhDigestItems();
    return NextResponse.json({ items });
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
