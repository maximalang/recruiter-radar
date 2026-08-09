"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  OnboardingAccessError,
  OnboardingValidationError,
  readOnboardingContext,
  saveOnboardingProgress,
  type OnboardingSubmission,
} from "@/lib/auth-v2/onboarding";
import { isAuthSameOriginRequest } from "@/lib/auth-v2/security";

function formValue(formData: FormData, name: string): FormDataEntryValue | null {
  return formData.get(name);
}

function parseSubmission(formData: FormData): OnboardingSubmission {
  const step = formValue(formData, "step");
  const intent = formValue(formData, "intent");

  if (step === "agency" && intent === "next") {
    return {
      step,
      intent,
      values: {
        fullName: formValue(formData, "fullName"),
        agencyName: formValue(formData, "agencyName"),
        agencyWebsite: formValue(formData, "agencyWebsite"),
        teamRole: formValue(formData, "teamRole"),
      },
    };
  }
  if (
    step === "profile"
    && (intent === "next" || intent === "back" || intent === "skip")
  ) {
    return {
      step,
      intent,
      values: {
        specialization: formValue(formData, "specialization"),
        roles: formData.getAll("roles"),
      },
    };
  }
  if (
    step === "market"
    && (intent === "next" || intent === "back" || intent === "skip")
  ) {
    return {
      step,
      intent,
      values: {
        industries: formData.getAll("industries"),
        companySizes: formData.getAll("companySizes"),
        geography: formValue(formData, "geography"),
        hiringMode: formValue(formData, "hiringMode"),
      },
    };
  }
  if (
    step === "delivery"
    && (intent === "next" || intent === "back" || intent === "skip")
  ) {
    return {
      step,
      intent,
      values: {
        deliveryChoice: formValue(formData, "deliveryChoice"),
        deliveryEmail: formValue(formData, "deliveryEmail"),
      },
    };
  }
  if (
    step === "complete"
    && (intent === "back" || intent === "finish")
  ) {
    return { step, intent, values: {} };
  }
  throw new OnboardingValidationError();
}

export async function saveOnboardingAction(formData: FormData): Promise<void> {
  const requestHeaders = await headers();
  if (!isAuthSameOriginRequest({ headers: requestHeaders })) {
    return redirect("/onboarding?error=request");
  }

  const context = await readOnboardingContext();
  if (!context) return redirect("/login?returnTo=/onboarding");

  let saved;
  try {
    saved = await saveOnboardingProgress(
      context,
      parseSubmission(formData),
    );
  } catch (error) {
    if (error instanceof OnboardingAccessError) {
      return redirect("/login?returnTo=/onboarding");
    }
    if (error instanceof OnboardingValidationError) {
      return redirect("/onboarding?error=invalid");
    }
    return redirect("/onboarding?error=unavailable");
  }
  if (saved.status === "completed") {
    return redirect("/dashboard?onboarding=complete");
  }
  return redirect("/onboarding");
}
