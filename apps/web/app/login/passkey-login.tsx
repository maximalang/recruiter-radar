"use client";

import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
} from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { useCallback, useEffect, useState } from "react";

import { isPasskeyCeremonyCancellation } from "@/lib/auth-v2/passkey-client";
import styles from "./login.module.css";

type OptionsResponse = {
  ok: boolean;
  options?: PublicKeyCredentialRequestOptionsJSON;
};

export function PasskeyLogin(props: { returnTo: string }) {
  const [supported, setSupported] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const authenticate = useCallback(async (
    useBrowserAutofill: boolean,
    active: () => boolean = () => true,
  ) => {
    if (!useBrowserAutofill) {
      setPending(true);
      setMessage(null);
    }
    try {
      const optionsResponse = await fetch(
        "/api/auth/passkeys/authentication/options",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ returnTo: props.returnTo }),
        },
      );
      const optionsBody = await optionsResponse.json() as OptionsResponse;
      if (!optionsResponse.ok || !optionsBody.ok || !optionsBody.options) {
        throw new Error("passkey_options_unavailable");
      }
      const response = await startAuthentication({
        optionsJSON: optionsBody.options,
        useBrowserAutofill,
      });
      const verification = await fetch(
        "/api/auth/passkeys/authentication/verify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response }),
        },
      );
      const result = await verification.json() as {
        ok?: boolean;
        destination?: string;
      };
      if (!verification.ok || !result.ok || !result.destination) {
        throw new Error("passkey_verification_failed");
      }
      window.location.assign(result.destination);
    } catch (error) {
      if (!active()) return;
      if (isPasskeyCeremonyCancellation(error)) {
        if (!useBrowserAutofill) {
          setMessage(
            "Окно ключа доступа закрыто. Можно продолжить вход по email.",
          );
        }
      } else if (!useBrowserAutofill) {
        setMessage(
          "Не удалось войти с ключом доступа. Вход по email остаётся доступен.",
        );
      }
    } finally {
      if (active() && !useBrowserAutofill) setPending(false);
    }
  }, [props.returnTo]);

  useEffect(() => {
    let mounted = true;
    if (!browserSupportsWebAuthn()) return () => {
      mounted = false;
    };
    setSupported(true);
    void browserSupportsWebAuthnAutofill()
      .then((available) => {
        if (mounted && available) {
          void authenticate(true, () => mounted);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [authenticate]);

  if (!supported) return null;
  return (
    <div className={styles.passkeyLogin}>
      <button
        type="button"
        className={styles.passkeyButton}
        disabled={pending}
        onClick={() => void authenticate(false)}
      >
        {pending ? "Проверяем ключ…" : "Войти с ключом доступа"}
      </button>
      {message ? (
        <p className={styles.passkeyMessage} role="status">{message}</p>
      ) : null}
      <div className={styles.divider} aria-hidden="true">
        <span>или по email</span>
      </div>
    </div>
  );
}
