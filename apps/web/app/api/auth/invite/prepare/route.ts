import { preparePendingAuthAction } from "@/lib/auth-v2/pending-action-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return preparePendingAuthAction(request, "workspace_invite");
}
