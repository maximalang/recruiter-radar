"use client";

import { useEffect } from "react";

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

  // Re-align direct hash navigation after streamed preview content settles at its final page height.
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

/**
 * Static product story (polish v2, stage 2): the preview has no form and no
 * presets, so the only client behavior left here is deep-link anchor
 * restoration after the page settles. `preview_started` is emitted from the
 * hero/header CTAs; form/preset contexts no longer exist.
 */
export default function LandingPreviewInteractions() {
  useEffect(() => {
    const removeAnchorRestoration = installPreviewAnchorRestoration();
    return removeAnchorRestoration;
  }, []);

  return <span hidden data-preview-interactions />;
}
