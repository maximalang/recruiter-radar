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

export async function sendLeadToTelegramAction(formData: FormData) {
  const leadId = Number(formData.get("leadId"));

  if (!Number.isInteger(leadId) || leadId <= 0) {
    redirectWithTelegramNotice("error", "Invalid lead id.");
  }

  const result = await sendLeadToTelegram(leadId).catch((error): never => {
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
