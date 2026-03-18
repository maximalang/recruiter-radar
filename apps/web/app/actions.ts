"use server";

import { revalidatePath } from "next/cache";

import { isActionableLeadStatus, updateLeadStatus } from "../lib/db";

export async function updateLeadStatusAction(formData: FormData) {
  const leadId = Number(formData.get("leadId"));
  const nextStatus = formData.get("status");

  if (!Number.isInteger(leadId) || leadId <= 0) {
    return;
  }

  if (!isActionableLeadStatus(nextStatus)) {
    return;
  }

  await updateLeadStatus(leadId, nextStatus);
  revalidatePath("/");
}
