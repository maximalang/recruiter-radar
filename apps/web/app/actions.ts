"use server";

import { revalidatePath } from "next/cache";

import { isActionableLeadStatus, updateLeadStatus } from "../lib/db";

export async function updateLeadStatusAction(formData: FormData) {
  // Wire field key stays "leadId" (external form contract); local var renamed
  // to candidateId to match the digest_candidates.id it actually addresses.
  const candidateId = Number(formData.get("leadId"));
  const nextStatus = formData.get("status");

  if (!Number.isInteger(candidateId) || candidateId <= 0) {
    return;
  }

  if (!isActionableLeadStatus(nextStatus)) {
    return;
  }

  await updateLeadStatus(candidateId, nextStatus);
  revalidatePath("/");
}
