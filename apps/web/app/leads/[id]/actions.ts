"use server";

import { updateLeadFeedback } from "@/lib/leads-data";

export async function updateLeadFeedbackAction(
  orgId: string,
  clientProfileId: string,
  feedbackStatus: string,
  feedbackNote?: string | null,
) {
  const result = await updateLeadFeedback({
    orgId,
    clientProfileId,
    feedbackStatus,
    feedbackNote,
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.data;
}
