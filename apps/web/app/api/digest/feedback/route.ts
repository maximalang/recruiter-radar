import { NextResponse } from "next/server";

import {
  isDigestFeedbackAction,
  updateDigestOrgStateFeedback
} from "../../../../lib/digestFeedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const digestApiKey = process.env.DIGEST_API_KEY;

  if (!digestApiKey) {
    return NextResponse.json({ error: "DIGEST_API_KEY is not configured." }, { status: 500 });
  }

  const providedApiKey = request.headers.get("x-api-key");

  if (providedApiKey !== digestApiKey) {
    return NextResponse.json({ error: "Invalid or missing x-api-key header." }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON object body is required." }, { status: 400 });
  }

  const payload = body as {
    clientProfileId?: string | number;
    orgId?: string | number | null;
    digestCandidateId?: string | number | null;
    action?: string;
    note?: string | null;
    snoozeDays?: number | null;
  };

  if (payload.clientProfileId == null) {
    return NextResponse.json({ error: "clientProfileId is required." }, { status: 400 });
  }

  if (!isDigestFeedbackAction(payload.action)) {
    return NextResponse.json(
      { error: "action must be one of accepted, badfit, dismissed, snooze, contacted, replied, won." },
      { status: 400 }
    );
  }

  if (payload.orgId == null && payload.digestCandidateId == null) {
    return NextResponse.json(
      { error: "orgId or digestCandidateId is required." },
      { status: 400 }
    );
  }

  try {
    const state = await updateDigestOrgStateFeedback({
      clientProfileId: payload.clientProfileId,
      orgId: payload.orgId,
      digestCandidateId: payload.digestCandidateId,
      action: payload.action,
      note: payload.note,
      snoozeDays: payload.snoozeDays
    });

    return NextResponse.json({ ok: true, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update digest feedback state.";
    const status = message.startsWith("Invalid ") || message.includes("is required") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
