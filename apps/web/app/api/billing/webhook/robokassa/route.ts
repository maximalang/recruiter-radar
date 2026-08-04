import { processPaymentWebhook } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "text/plain; charset=utf-8",
};

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}

async function handle(request: Request): Promise<Response> {
  try {
    const result = await processPaymentWebhook("robokassa", request);
    return new Response(result.body, { status: result.status, headers: HEADERS });
  } catch {
    return new Response("Temporary processing error.", { status: 503, headers: HEADERS });
  }
}
