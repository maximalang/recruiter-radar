"use client";

import { useEffect, useRef } from "react";

const PREVIEW_ANALYTICS_EVENT = "landing:analytics";

function emitPreviewStarted(context: "form" | "preset") {
  window.dispatchEvent(new CustomEvent(PREVIEW_ANALYTICS_EVENT, {
    detail: { name: "preview_started", context },
  }));
}

export default function LandingPreviewInteractions() {
  const markerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = markerRef.current?.closest<HTMLElement>("[data-preview-section-content]");
    const form = root?.querySelector<HTMLFormElement>("[data-preview-form]");
    const submit = form?.querySelector<HTMLButtonElement>("[data-preview-submit]");
    const idleLabel = submit?.querySelector<HTMLElement>("[data-preview-submit-label]");
    const busyLabel = submit?.querySelector<HTMLElement>("[data-preview-submit-status]");
    if (!root || !form || !submit || !idleLabel || !busyLabel) return;

    const resetSubmittingState = () => {
      form.setAttribute("aria-busy", "false");
      form.removeAttribute("data-submitting");
      submit.disabled = false;
      idleLabel.hidden = false;
      busyLabel.hidden = true;
    };

    const handleSubmit = (event: SubmitEvent) => {
      if (form.getAttribute("aria-busy") === "true") {
        event.preventDefault();
        return;
      }

      form.setAttribute("aria-busy", "true");
      form.setAttribute("data-submitting", "true");
      submit.disabled = true;
      idleLabel.hidden = true;
      busyLabel.hidden = false;
      emitPreviewStarted("form");
    };

    const handlePresetClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("[data-preview-preset]")) return;
      emitPreviewStarted("preset");
    };

    const handlePageShow = () => resetSubmittingState();

    form.addEventListener("submit", handleSubmit);
    root.addEventListener("click", handlePresetClick);
    window.addEventListener("pageshow", handlePageShow);
    window.dispatchEvent(new CustomEvent(PREVIEW_ANALYTICS_EVENT, {
      detail: { name: "preview_generated" },
    }));

    return () => {
      form.removeEventListener("submit", handleSubmit);
      root.removeEventListener("click", handlePresetClick);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  return <span ref={markerRef} hidden data-preview-interactions />;
}
