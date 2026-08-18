import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      gitSha: process.env.GIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
      buildTime: process.env.BUILD_TIME ?? "unknown",
      environment: process.env.NODE_ENV ?? "unknown",
      runtimeVersion: process.version,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
