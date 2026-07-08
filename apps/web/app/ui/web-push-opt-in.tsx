"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckIcon } from "./icons";

type PushState =
  | "loading"
  | "not_supported"
  | "permission_denied"
  | "unsubscribed"
  | "subscribed";

type WebPushOptInProps = {
  /** Whether web-push is configured on the server (VAPID present). */
  configured: boolean;
  /** Public VAPID key, base64url. Null when not configured. */
  publicKey: string | null;
};

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Back the array with a concrete ArrayBuffer so it satisfies BufferSource
  // (applicationServerKey) under TS lib.dom's ArrayBufferView<ArrayBuffer>.
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function WebPushOptIn(props: WebPushOptInProps) {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine the initial state from the browser on mount.
  useEffect(() => {
    let cancelled = false;

    async function resolveInitialState() {
      if (!props.configured || !props.publicKey || !isSupported()) {
        if (!cancelled) setState(isSupported() ? "unsubscribed" : "not_supported");
        return;
      }

      if (Notification.permission === "denied") {
        if (!cancelled) setState("permission_denied");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const existing = registration ? await registration.pushManager.getSubscription() : null;
        if (!cancelled) setState(existing ? "subscribed" : "unsubscribed");
      } catch {
        if (!cancelled) setState("unsubscribed");
      }
    }

    void resolveInitialState();
    return () => {
      cancelled = true;
    };
  }, [props.configured, props.publicKey]);

  const subscribe = useCallback(async () => {
    if (!props.publicKey) return;
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        setState("permission_denied");
        return;
      }
      if (permission !== "granted") {
        setState("unsubscribed");
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(props.publicKey),
      });

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error ?? "Не удалось подключить уведомления.");
        return;
      }

      setState("subscribed");
    } catch {
      setError("Не удалось подключить уведомления в этом браузере.");
    } finally {
      setBusy(false);
    }
  }, [props.publicKey]);

  const unsubscribe = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined);
        await subscription.unsubscribe().catch(() => undefined);
      }
      setState("unsubscribed");
    } catch {
      setError("Не удалось отключить уведомления.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <strong>Получать мгновенные сигналы о новых сильных лидах</strong>
      <WebPushStatusBody
        state={state}
        configured={props.configured}
        busy={busy}
        onSubscribe={subscribe}
        onUnsubscribe={unsubscribe}
      />
      {error ? <span role="alert" style={{ color: "#b42318" }}>{error}</span> : null}
    </div>
  );
}

function WebPushStatusBody(props: {
  state: PushState;
  configured: boolean;
  busy: boolean;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
}) {
  if (!props.configured) {
    return <span>Web push скоро станет доступен.</span>;
  }

  switch (props.state) {
    case "loading":
      return <span>Проверяем браузер…</span>;
    case "not_supported":
      return <span>Этот браузер не поддерживает push-уведомления.</span>;
    case "permission_denied":
      return (
        <span>
          Уведомления заблокированы в настройках браузера. Разрешите их для этого сайта, чтобы получать сигналы.
        </span>
      );
    case "subscribed":
      return (
        <div style={{ display: "grid", gap: "6px" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <CheckIcon style={{ width: "1em", height: "1em", color: "#047857" }} aria-hidden="true" />
            Уведомления подключены в этом браузере.
          </span>
          <button type="button" onClick={props.onUnsubscribe} disabled={props.busy}>
            {props.busy ? "Отключаем…" : "Отключить"}
          </button>
        </div>
      );
    case "unsubscribed":
    default:
      return (
        <div style={{ display: "grid", gap: "6px" }}>
          <span>Подключите браузер, чтобы первым узнавать о сильных лидах.</span>
          <button type="button" onClick={props.onSubscribe} disabled={props.busy}>
            {props.busy ? "Подключаем…" : "Включить уведомления"}
          </button>
        </div>
      );
  }
}
