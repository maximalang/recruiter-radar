import { logEvent } from "@/lib/runtime";

const EVENT_NAMES = new Set([
  "landing_viewed",
  "preview_started",
  "preview_generated",
  "preview_checkout_clicked",
  "pilot_cta_clicked",
  "closing_cta_clicked",
  "checkout_viewed",
  "payment_started",
  "continuation_requested",
  "payment_succeeded",
]);

const CONTEXT_PATTERN = /^[a-z0-9:_-]{1,64}$/i;

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "invalid_content_type" }, { status: 415 });
  }

  const raw = await request.text();
  if (raw.length === 0 || raw.length > 512) {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  const name = record.name;
  const context = record.context;
  const hasOnlyEnvelopeFields = keys.every((key) => key === "name" || key === "context");
  if (
    !hasOnlyEnvelopeFields
    || typeof name !== "string"
    || !EVENT_NAMES.has(name)
    || (context !== undefined && (typeof context !== "string" || !CONTEXT_PATTERN.test(context)))
  ) {
    return Response.json({ error: "invalid_event" }, { status: 400 });
  }

  logEvent("landing_analytics_event", { name, ...(context ? { context } : {}) });
  return new Response(null, { status: 204 });
}
