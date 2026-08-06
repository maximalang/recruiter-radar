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

function installPreviewAnchorRestoration() {
  const hash = decodeURIComponent(window.location.hash.slice(1));
  if (!hash) return () => {};

  const target = document.getElementById(hash);
  const previewResults = document.querySelector<HTMLElement>("[data-preview-results]");
  if (!target || !previewResults || target === previewResults || previewResults.contains(target)) {
    return () => {};
  }

  const targetFollowsPreview = Boolean(
    previewResults.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  if (!targetFollowsPreview) return () => {};

  let animationFrame = 0;
  const restoreAnchor = () => {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = window.requestAnimationFrame(() => {
      const root = document.documentElement;
      const previousScrollBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      target.scrollIntoView({ block: "start" });
      root.style.scrollBehavior = previousScrollBehavior;
    });
  };

  const hasReadyResults = () => Boolean(
    previewResults.querySelector("[data-preview-results-ready]"),
  );

  if (hasReadyResults()) {
    restoreAnchor();
    return () => window.cancelAnimationFrame(animationFrame);
  }

  // Restore the hash target after streamed preview content reaches its final page height.
  const observer = new MutationObserver(() => {
    if (!hasReadyResults()) return;
    observer.disconnect();
    restoreAnchor();
  });
  observer.observe(previewResults, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    window.cancelAnimationFrame(animationFrame);
  };
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

    const removeAnchorRestoration = installPreviewAnchorRestoration();
    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("click", handlePresetClick);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      removeAnchorRestoration();
      document.removeEventListener("submit", handleSubmit, true);
      document.removeEventListener("click", handlePresetClick);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  return <span hidden data-preview-interactions />;
}
