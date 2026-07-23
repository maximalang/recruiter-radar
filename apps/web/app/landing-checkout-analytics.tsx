"use client";

import { useEffect } from "react";

import { sendLandingEvent } from "./landing-analytics";

export default function LandingCheckoutAnalytics(props: {
  trackPaymentStart: boolean;
}) {
  useEffect(() => {
    sendLandingEvent({ name: "checkout_viewed" });
    if (!props.trackPaymentStart) return;

    const form = document.querySelector<HTMLFormElement>("[data-checkout-form]");
    if (!form) return;
    const handleSubmit = () => sendLandingEvent({ name: "payment_started" });
    form.addEventListener("submit", handleSubmit);
    return () => form.removeEventListener("submit", handleSubmit);
  }, [props.trackPaymentStart]);

  return null;
}
