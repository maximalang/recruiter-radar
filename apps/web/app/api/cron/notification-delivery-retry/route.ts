import { NextRequest, NextResponse } from "next/server";

import { retryDueNotificationDeliveries } from "@/lib/notification-dispatch";
import { redactProviderSecret } from "@/lib/notification-secrets";
import { logError, logEvent } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_CONFIGURATION_ERROR = "Notification retry service is not configured.";
const PUBLIC_PROCESSING_ERROR = "Notification retry queue failed.";

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
      { success: false, error: PUBLIC_CONFIGURATION_ERROR },
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
    const rawMessage = error instanceof Error ? error.message : PUBLIC_PROCESSING_ERROR;
    const safeMessage = redactProviderSecret(rawMessage).slice(0, 1000);
    logError("notification.retry_queue.failed", new Error(safeMessage), {
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        success: false,
        error: PUBLIC_PROCESSING_ERROR,
      },
      { status: 500 },
    );
  }
}
