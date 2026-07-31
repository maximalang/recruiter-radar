import { NextRequest, NextResponse } from "next/server";

import { checkOperatorAccess } from "@/lib/operator-auth";
import {
  getNpdReceiptSummary,
  listNpdReceiptTasks,
  markNpdReceiptCanceled,
  markNpdReceiptIssued,
  retryNpdReceiptDelivery,
} from "@/lib/npdReceipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;

  try {
    const [summary, tasks] = await Promise.all([
      getNpdReceiptSummary(),
      listNpdReceiptTasks(200),
    ]);
    return NextResponse.json(
      { ok: true, summary, tasks },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "npd_receipts_unavailable" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;

  let payload: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    payload = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const action = typeof payload.action === "string" ? payload.action : "";
  const receiptId = typeof payload.receiptId === "string" || typeof payload.receiptId === "number"
    ? payload.receiptId
    : "";

  try {
    if (action === "mark-issued") {
      const receiptUrl = typeof payload.receiptUrl === "string" ? payload.receiptUrl : "";
      const receiptNumber = typeof payload.receiptNumber === "string" ? payload.receiptNumber : null;
      const task = await markNpdReceiptIssued({ receiptId, receiptUrl, receiptNumber });
      return NextResponse.json({ ok: true, task }, { status: 200, headers: NO_STORE_HEADERS });
    }

    if (action === "mark-canceled") {
      const reason = typeof payload.reason === "string" ? payload.reason : null;
      const task = await markNpdReceiptCanceled({ receiptId, reason });
      return NextResponse.json({ ok: true, task }, { status: 200, headers: NO_STORE_HEADERS });
    }

    if (action === "retry-delivery") {
      const task = await retryNpdReceiptDelivery(receiptId);
      return NextResponse.json({ ok: true, task }, { status: 200, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(
      { ok: false, error: "unsupported_action" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "npd_receipt_operation_failed",
        message: error instanceof Error ? error.message : "Операция с НПД-чеком не выполнена.",
      },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }
}

async function requireOperator(): Promise<NextResponse | null> {
  const access = await checkOperatorAccess();
  if (access.ok) return null;
  return NextResponse.json(
    { ok: false, error: "operator_access_required" },
    { status: 401, headers: NO_STORE_HEADERS },
  );
}
