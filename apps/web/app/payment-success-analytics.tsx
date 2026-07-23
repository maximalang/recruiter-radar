"use client";

import { useEffect } from "react";

import { sendLandingEvent } from "./landing-analytics";

export default function PaymentSuccessAnalytics(props: { dedupeKey: string }) {
  useEffect(() => {
    const storageKey = `rr:payment-succeeded:${props.dedupeKey}`;
    try {
      if (sessionStorage.getItem(storageKey)) return;
      sessionStorage.setItem(storageKey, "1");
    } catch {
      // Storage can be disabled; telemetry remains best-effort.
    }
    sendLandingEvent({ name: "payment_succeeded" });
  }, [props.dedupeKey]);

  return null;
}
