import { NextResponse } from "next/server";
import { getDashboardQualityMetrics } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const metrics = await getDashboardQualityMetrics();
    return NextResponse.json(metrics);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
