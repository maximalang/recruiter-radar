import { NextResponse } from "next/server";

import { getHhDigestItems } from "../../../../lib/hhDigest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
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
