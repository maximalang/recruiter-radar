"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 40; // 2 minutes max

export function TelegramStepAutoRefresh({ orderId }: { orderId: string }) {
  const router = useRouter();
  const pollCount = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stopped = false;

    async function poll() {
      if (stopped) return;

      pollCount.current += 1;

      try {
        const res = await fetch(`/api/telegram/connect-status?orderId=${encodeURIComponent(orderId)}`);
        if (res.ok) {
          const data = await res.json() as { connected?: boolean };
          if (data.connected) {
            router.refresh();
            return;
          }
        }
      } catch {
        // network error — keep polling
      }

      if (!stopped && pollCount.current < MAX_POLLS) {
        timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      if (timerRef.current != null) clearTimeout(timerRef.current);
    };
  }, [orderId, router]);

  return null;
}
