"use client";

import { useEffect } from "react";

import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_DOM_EVENT,
  LANDING_ANALYTICS_EVENT,
  type LandingAnalyticsContext,
} from "../lib/landing-analytics-contract";

function emitPreviewStarted(context: LandingAnalyticsContext) {
  window.dispatchEvent(new CustomEvent(LANDING_ANALYTICS_DOM_EVENT, {
    detail: { name: LANDING_ANALYTICS_EVENT.previewStarted, context },
  }));
}

function getFormControls(form: HTMLFormElement) {
  const submit = form.querySelector<HTMLButtonElement>("[data-preview-submit]");
  const idleLabel = submit?.querySelector<HTMLElement>("[data-preview-submit-label]");
  const busyLabel = submit?.querySelector<HTMLElement>("[data-preview-submit-status]");
  if (!submit || !idleLabel || !busyLabel) return null;
  return { submit, idleLabel, busyLabel };
}

function resetSubmittingState(form: HTMLFormElement) {
  const controls = getFormControls(form);
  if (!controls) return;

  form.setAttribute("aria-busy", "false");
  form.removeAttribute("data-submitting");
  controls.submit.disabled = false;
  controls.idleLabel.hidden = false;
  controls.busyLabel.hidden = true;
}

export default function LandingPreviewInteractions() {
  useEffect(() => {
    const handleSubmit = (event: Event) => {
      const form = event.target;
      if (
        !(form instanceof HTMLFormElement)
        || !form.matches("[data-preview-form]")
        || !form.closest("[data-preview-section-content]")
      ) return;

      if (form.getAttribute("aria-busy") === "true") {
        event.preventDefault();
        return;
      }

      const controls = getFormControls(form);
      if (!controls) return;

      form.setAttribute("aria-busy", "true");
      form.setAttribute("data-submitting", "true");
      controls.submit.disabled = true;
      controls.idleLabel.hidden = true;
      controls.busyLabel.hidden = false;
      emitPreviewStarted(LANDING_ANALYTICS_CONTEXT.form);
    };

    const handlePresetClick = (event: Event) => {
      const target = event.target;
      const preset = target instanceof Element
        ? target.closest("[data-preview-preset]")
        : null;
      if (!preset?.closest("[data-preview-section-content]")) return;
      emitPreviewStarted(LANDING_ANALYTICS_CONTEXT.preset);
    };

    const handlePageShow = () => {
      document.querySelectorAll<HTMLFormElement>("[data-preview-form]")
        .forEach(resetSubmittingState);
    };

    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("click", handlePresetClick);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("submit", handleSubmit, true);
      document.removeEventListener("click", handlePresetClick);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  return <span hidden data-preview-interactions />;
}
