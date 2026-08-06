import { NextRequest, NextResponse } from "next/server";

import { checkOperatorAccess } from "@/lib/operator-auth";
import {
  listPaymentRefunds,
  requestRobokassaRefund,
  syncRobokassaRefund,
} from "@/lib/paymentRefunds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  const access = await checkOperatorAccess();
  if (!access.ok) return denied();

  try {
    const refunds = await listPaymentRefunds(200);
    return NextResponse.json({ ok: true, refunds }, { headers: HEADERS });
  } catch {
    return NextResponse.json(
      { ok: false, error: "refunds_unavailable" },
      { status: 503, headers: HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  const access = await checkOperatorAccess();
  if (!access.ok) return denied();

  let payload: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    payload = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400, headers: HEADERS },
    );
  }

  const action = typeof payload.action === "string" ? payload.action : "";

  try {
    if (action === "request") {
      const orderId = readId(payload.orderId);
      const amountMinor = payload.amountMinor == null ? null : readPositiveInteger(payload.amountMinor);
      const refund = await requestRobokassaRefund({
        orderId,
        amountMinor,
        requestedBy: `operator:${access.via}`,
      });
      return NextResponse.json({ ok: true, refund }, { headers: HEADERS });
    }

    if (action === "sync") {
      const refund = await syncRobokassaRefund(readId(payload.refundId));
      return NextResponse.json({ ok: true, refund }, { headers: HEADERS });
    }

    return NextResponse.json(
      { ok: false, error: "unsupported_action" },
      { status: 400, headers: HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "refund_operation_failed",
        message: error instanceof Error ? error.message : "Операция возврата не выполнена.",
      },
      { status: 409, headers: HEADERS },
    );
  }
}

function denied() {
  return NextResponse.json(
    { ok: false, error: "operator_access_required" },
    { status: 401, headers: HEADERS },
  );
}

function readId(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("Идентификатор обязателен.");
  }
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) throw new Error("Некорректный идентификатор.");
  return normalized;
}

function readPositiveInteger(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error("Сумма возврата должна быть указана в целых копейках.");
  }
  return number;
}
