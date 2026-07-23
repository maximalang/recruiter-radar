"use client";

import { useEffect } from "react";

const PREVIEW_ANALYTICS_EVENT = "landing:analytics";

function emitPreviewStarted(context: "form" | "preset") {
  window.dispatchEvent(new CustomEvent(PREVIEW_ANALYTICS_EVENT, {
    detail: { name: "preview_started", context },
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
      emitPreviewStarted("form");
    };

    const handlePresetClick = (event: Event) => {
      const target = event.target;
      const preset = target instanceof Element
        ? target.closest("[data-preview-preset]")
        : null;
      if (!preset?.closest("[data-preview-section-content]")) return;
      emitPreviewStarted("preset");
    };

    const handlePageShow = () => {
      document.querySelectorAll<HTMLFormElement>("[data-preview-form]")
        .forEach(resetSubmittingState);
    };

    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("click", handlePresetClick);
    window.addEventListener("pageshow", handlePageShow);
    window.dispatchEvent(new CustomEvent(PREVIEW_ANALYTICS_EVENT, {
      detail: { name: "preview_generated" },
    }));

    return () => {
      document.removeEventListener("submit", handleSubmit, true);
      document.removeEventListener("click", handlePresetClick);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  return <span hidden data-preview-interactions />;
}
