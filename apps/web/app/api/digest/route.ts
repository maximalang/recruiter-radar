import { NextResponse } from "next/server";

import { runDigestForClientProfile } from "../../../lib/digest";
import { assertDigestEntitlementByClientProfileId } from "../../../lib/db";
import type { DigestInput, DigestOutput, ApiResponse } from "../../../lib/api-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const digestApiKey = process.env.DIGEST_API_KEY;
  if (!digestApiKey) {
    return NextResponse.json({
      success: false,
      error: "DIGEST_API_KEY is not configured.",
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID()
      }
    }, { status: 500 });
  }

  const authHeader = request.headers.get("x-api-key");
  if (authHeader !== digestApiKey) {
    return NextResponse.json({
      success: false,
      error: "Invalid or missing x-api-key header.",
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID()
      }
    }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);

    // Parse and validate input using zod
    const input = {
      clientProfileId: searchParams.get("clientProfileId")!,
      sourceKey: searchParams.get("sourceKey") || undefined,
      limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
      cooldownDays: searchParams.get("cooldownDays") ? Number(searchParams.get("cooldownDays")) : undefined,
    };

    // Input validation without zod for now
    if (!input.clientProfileId) {
      return NextResponse.json({
        success: false,
        error: "clientProfileId is required.",
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: crypto.randomUUID()
        }
      }, { status: 400 });
    }

    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit <= 0)) {
      return NextResponse.json({
        success: false,
        error: "limit must be a positive integer.",
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: crypto.randomUUID()
        }
      }, { status: 400 });
    }

    if (input.cooldownDays !== undefined && (!Number.isInteger(input.cooldownDays) || input.cooldownDays <= 0)) {
      return NextResponse.json({
        success: false,
        error: "cooldownDays must be a positive integer.",
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: crypto.randomUUID()
        }
      }, { status: 400 });
    }

    await assertDigestEntitlementByClientProfileId(input.clientProfileId);

    const result = await runDigestForClientProfile(input);

    return NextResponse.json({
      success: true,
      data: result,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID()
      }
    }, { status: 200 });
  } catch (error) {
    if (error && typeof error === 'object' && 'errors' in error) {
      // Zod error structure
      const validationError = error as any;
      return NextResponse.json({
        success: false,
        error: "Validation failed: " + validationError.errors.map((e: any) => e.message).join(", "),
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: crypto.randomUUID()
        }
      }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Failed to run digest.";
    const status = message.includes("inactive") || message.includes("No active subscription") || message.includes("entitlement") ? 403 :
                   message.includes("not found") ? 404 : 500;

    return NextResponse.json({
      success: false,
      error: message,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID()
      }
    }, { status });
  }
}