"use client";

import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server";
import { useState } from "react";

import { isPasskeyCeremonyCancellation } from "@/lib/auth-v2/passkey-client";
import styles from "./security-settings.module.css";

export type PasskeyView = {
  id: string;
  name: string;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  backupEligible: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

export function PasskeySettings(props: { initialPasskeys: PasskeyView[] }) {
  const [passkeys, setPasskeys] = useState(props.initialPasskeys);
  const [name, setName] = useState("Моё устройство");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function addPasskey() {
    setMessage(null);
    if (!browserSupportsWebAuthn()) {
      setMessage("Этот браузер не поддерживает ключи доступа.");
      return;
    }
    setPending(true);
    try {
      const optionsResponse = await fetch(
        "/api/auth/passkeys/registration/options",
        { method: "POST" },
      );
      const optionsBody = await optionsResponse.json() as {
        ok?: boolean;
        code?: string;
        options?: PublicKeyCredentialCreationOptionsJSON;
      };
      if (
        optionsResponse.status === 401
        && optionsBody.code === "reauth_required"
      ) {
        setMessage("Сначала войдите в аккаунт заново, затем добавьте ключ.");
        return;
      }
      if (!optionsResponse.ok || !optionsBody.options) {
        throw new Error("passkey_options_unavailable");
      }
      const response = await startRegistration({
        optionsJSON: optionsBody.options,
      });
      const verification = await fetch(
        "/api/auth/passkeys/registration/verify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, response }),
        },
      );
      const result = await verification.json() as {
        ok?: boolean;
        code?: string;
        passkey?: PasskeyView;
      };
      if (!verification.ok || !result.ok || !result.passkey) {
        if (result.code === "reauth_required") {
          setMessage("Сначала войдите в аккаунт заново, затем добавьте ключ.");
          return;
        }
        throw new Error("passkey_registration_failed");
      }
      setPasskeys((current) => [result.passkey!, ...current]);
      setMessage("Ключ доступа добавлен.");
    } catch (error) {
      setMessage(
        isPasskeyCeremonyCancellation(error)
          ? "Добавление отменено. Текущие способы входа не изменились."
          : "Не удалось добавить ключ доступа. Попробуйте ещё раз.",
      );
    } finally {
      setPending(false);
    }
  }

  async function renamePasskey(passkeyId: string, nextName: string) {
    const response = await fetch(`/api/auth/passkeys/${passkeyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nextName }),
    });
    if (!response.ok) {
      setMessage("Не удалось переименовать ключ доступа.");
      return;
    }
    setPasskeys((current) => current.map((passkey) => (
      passkey.id === passkeyId
        ? { ...passkey, name: nextName.trim() }
        : passkey
    )));
    setMessage("Название ключа обновлено.");
  }

  async function removePasskey(passkeyId: string) {
    const response = await fetch(`/api/auth/passkeys/${passkeyId}`, {
      method: "DELETE",
    });
    const body = await response.json().catch(() => ({})) as { code?: string };
    if (!response.ok) {
      setMessage(
        body.code === "reauth_required"
          ? "Сначала войдите в аккаунт заново, затем удалите ключ."
          : "Не удалось удалить ключ доступа.",
      );
      return;
    }
    setPasskeys((current) => current.filter(
      (passkey) => passkey.id !== passkeyId,
    ));
    setMessage("Ключ доступа удалён. Вход по подтверждённому email доступен.");
  }

  return (
    <section className={styles.card} aria-labelledby="passkey-settings">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>Без пароля</span>
          <h2 id="passkey-settings">Ключи доступа</h2>
        </div>
        <span className={styles.count}>{passkeys.length}</span>
      </div>
      <p className={styles.muted}>
        Ключ хранится на вашем устройстве или в защищённом менеджере. Приватный
        ключ не передаётся Recruiter Radar, а подтверждённый email остаётся
        резервным способом входа и восстановления.
      </p>
      {message ? (
        <div className={styles.notice} role="status">{message}</div>
      ) : null}
      <div className={styles.passkeyCreate}>
        <label>
          <span>Название нового ключа</span>
          <input
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={pending || name.trim().length === 0}
          onClick={() => void addPasskey()}
        >
          {pending ? "Добавляем…" : "Добавить ключ"}
        </button>
      </div>
      {passkeys.length ? (
        <ul className={styles.passkeyList}>
          {passkeys.map((passkey) => (
            <PasskeyItem
              key={passkey.id}
              passkey={passkey}
              onRename={renamePasskey}
              onRemove={removePasskey}
            />
          ))}
        </ul>
      ) : (
        <p className={styles.passkeyEmpty}>
          Ключей пока нет. Это дополнительный способ входа, а не обязательный
          шаг регистрации.
        </p>
      )}
    </section>
  );
}

function PasskeyItem(props: {
  passkey: PasskeyView;
  onRename: (id: string, name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState(props.passkey.name);
  return (
    <li className={styles.passkeyItem}>
      <div className={styles.passkeyDetails}>
        <label>
          <span className={styles.srOnly}>Название ключа доступа</span>
          <input
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p>
          {props.passkey.deviceType === "multiDevice"
            ? "Синхронизируемый ключ"
            : "Ключ одного устройства"}
          {props.passkey.backedUp ? " · резервная копия включена" : ""}
        </p>
        <time dateTime={props.passkey.lastUsedAt ?? props.passkey.createdAt}>
          {props.passkey.lastUsedAt
            ? `Последний вход: ${formatDate(props.passkey.lastUsedAt)}`
            : `Добавлен: ${formatDate(props.passkey.createdAt)}`}
        </time>
      </div>
      <div className={styles.passkeyActions}>
        <button
          type="button"
          className={styles.quietButton}
          disabled={!name.trim() || name.trim() === props.passkey.name}
          onClick={() => void props.onRename(props.passkey.id, name)}
        >
          Сохранить
        </button>
        <button
          type="button"
          className={styles.dangerButton}
          onClick={() => void props.onRemove(props.passkey.id)}
        >
          Удалить
        </button>
      </div>
    </li>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
