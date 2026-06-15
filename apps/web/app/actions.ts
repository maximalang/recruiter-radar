"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isActionableLeadStatus, sendLeadToTelegram, updateLeadStatus } from "../lib/db";

function redirectWithTelegramNotice(status: "success" | "error", message: string): never {
  const params = new URLSearchParams({
    telegramStatus: status,
    telegramMessage: message
  });

  return redirect(`/?${params.toString()}`);
}

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

export async function sendLeadToTelegramAction(formData: FormData) {
  const candidateId = Number(formData.get("leadId"));

  if (!Number.isInteger(candidateId) || candidateId <= 0) {
    redirectWithTelegramNotice("error", "Invalid lead id.");
  }

  const result = await sendLeadToTelegram(candidateId).catch((error): never => {
    revalidatePath("/");
    const message = error instanceof Error ? error.message : "Failed to send lead to Telegram.";
    return redirectWithTelegramNotice("error", message);
  });

  revalidatePath("/");

  if (!result.ok) {
    redirectWithTelegramNotice("error", result.error);
  }

  redirectWithTelegramNotice("success", "Lead sent to Telegram.");
}
