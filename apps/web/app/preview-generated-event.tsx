"use client";

import { useEffect } from "react";

import {
  LANDING_ANALYTICS_EVENT,
  type LandingAnalyticsContext,
} from "../lib/landing-analytics-contract";
import { sendLandingEvent } from "./landing-analytics";

const handledQueries = new Set<string>();

async function queryFingerprint(query: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(query),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default function PreviewGeneratedEvent(props: {
  generated: boolean;
  context: LandingAnalyticsContext;
}) {
  useEffect(() => {
    if (!props.generated) return;

    const query = window.location.search;
    if (handledQueries.has(query)) return;
    handledQueries.add(query);

    void queryFingerprint(query).then((fingerprint) => {
      const storageKey = fingerprint ? `rr:preview-generated:${fingerprint}` : null;
      try {
        if (storageKey && sessionStorage.getItem(storageKey)) return;
        if (storageKey) sessionStorage.setItem(storageKey, "1");
      } catch {
        // In-memory dedupe above remains active when storage is unavailable.
      }

      sendLandingEvent({
        name: LANDING_ANALYTICS_EVENT.previewGenerated,
        context: props.context,
      });
    });
  }, [props.context, props.generated]);

  return null;
}
