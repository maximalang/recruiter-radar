import { NextRequest, NextResponse } from "next/server";

import { retryDueNotificationDeliveries } from "@/lib/notification-dispatch";
import { logError, logEvent } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "notification-delivery-retry",
    hint: "Use POST with x-api-key. Schedule this endpoint hourly.",
  });
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.CRON_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "CRON_API_KEY is not configured." },
      { status: 500 },
    );
  }
  if (request.headers.get("x-api-key") !== apiKey) {
    return NextResponse.json(
      { success: false, error: "Invalid or missing x-api-key header." },
      { status: 401 },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await retryDueNotificationDeliveries({ limit: 100 });
    logEvent("notification.retry_queue.drained", {
      durationMs: Date.now() - startedAt,
      batches: result.batches,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
    });
    return NextResponse.json({
      success: result.failed === 0,
      durationMs: Date.now() - startedAt,
      ...result,
    });
  } catch (error) {
    logError("notification.retry_queue.failed", error, {
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Notification retry queue failed.",
      },
      { status: 500 },
    );
  }
}
