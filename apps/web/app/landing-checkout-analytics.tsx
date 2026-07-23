"use client";

import { useEffect } from "react";

import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
} from "../lib/landing-analytics-contract";
import { sendLandingEvent } from "./landing-analytics";

export default function LandingCheckoutAnalytics(props: {
  submitEvent:
    | typeof LANDING_ANALYTICS_EVENT.paymentStarted
    | typeof LANDING_ANALYTICS_EVENT.continuationRequested;
}) {
  useEffect(() => {
    sendLandingEvent({
      name: LANDING_ANALYTICS_EVENT.checkoutViewed,
      context: LANDING_ANALYTICS_CONTEXT.checkoutForm,
    });

    const form = document.querySelector<HTMLFormElement>("[data-checkout-form]");
    if (!form) return;
    const handleSubmit = () => sendLandingEvent({
      name: props.submitEvent,
      context: LANDING_ANALYTICS_CONTEXT.checkoutForm,
    });
    form.addEventListener("submit", handleSubmit);
    return () => form.removeEventListener("submit", handleSubmit);
  }, [props.submitEvent]);

  return null;
}
