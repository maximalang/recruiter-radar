"use client";

import { useActionState } from "react";

import type { NotificationConnection } from "../../lib/notifications";
import { FormSubmitButton } from "../ui/form-submit-button";
import { NoticeBox } from "../ui/page-primitives";
import {
  addTelegramNotificationAction,
  addVkNotificationAction,
  addWebhookNotificationAction,
  createNotificationBindingAction,
  disconnectNotificationConnectionAction,
  reconcileVkNotificationAction,
  testNotificationConnectionAction,
  type NotificationActionResult,
} from "./notification-actions";
import styles from "./notification-channels.module.css";

const PROVIDER_LABELS: Record<NotificationConnection["provider"], string> = {
  telegram: "Telegram",
  vk: "ВКонтакте",
  webhook: "Webhook / n8n",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Работает",
  degraded: "Нужна проверка",
  pending_verification: "Проверяется",
  paused: "На паузе",
  error: "Ошибка",
};

function ActionFeedback({ state }: { state: NotificationActionResult | null }) {
  if (!state) return null;
  return (
    <div className={styles.feedback}>
      <NoticeBox
        tone={state.ok ? "success" : "danger"}
        title={state.ok ? "Готово" : "Не удалось"}
        description={state.message}
      />
      {state.privateLink || state.groupLink ? (
        <div className={styles.linkGrid}>
          {state.privateLink ? (
            <a className={styles.primaryLink} href={state.privateLink} target="_blank" rel="noreferrer">
              Подключить личный чат
            </a>
          ) : null}
          {state.groupLink ? (
            <a className={styles.secondaryLink} href={state.groupLink} target="_blank" rel="noreferrer">
              Добавить бота в группу
            </a>
          ) : null}
        </div>
      ) : null}
      {state.connectCommand ? (
        <div className={styles.secretBox}>
          <span>Отправьте сообществу команду:</span>
          <code>{state.connectCommand}</code>
        </div>
      ) : null}
      {state.signingSecret ? (
        <div className={styles.secretBox}>
          <span>HMAC secret — сохраните сейчас:</span>
          <code>{state.signingSecret}</code>
        </div>
      ) : null}
    </div>
  );
}

function AddTelegramForm() {
  const [state, action] = useActionState(addTelegramNotificationAction, null);
  return (
    <details className={styles.addCard}>
      <summary>
        <span className={styles.providerIcon}>TG</span>
        <span><strong>Telegram-бот</strong><small>Клиент создаёт бота в BotFather и владеет им</small></span>
      </summary>
      <form action={action} className={styles.form}>
        <label>
          <span>Название внутри Radar</span>
          <input name="displayName" placeholder="Бот агентства" maxLength={120} />
        </label>
        <label>
          <span>Токен из BotFather</span>
          <input name="botToken" type="password" autoComplete="off" placeholder="123456789:AA..." required />
        </label>
        <p className={styles.hint}>Radar проверит токен, настроит защищённый webhook и выдаст ссылки для личного чата или рабочей группы.</p>
        <FormSubmitButton idleLabel="Подключить Telegram" pendingLabel="Проверяем бота..." className={styles.submit} />
      </form>
      <ActionFeedback state={state} />
    </details>
  );
}

function AddVkForm() {
  const [state, action] = useActionState(addVkNotificationAction, null);
  return (
    <details className={styles.addCard}>
      <summary>
        <span className={styles.providerIcon}>VK</span>
        <span><strong>Сообщество ВКонтакте</strong><small>Сообщения через ключ доступа сообщества</small></span>
      </summary>
      <form action={action} className={styles.form}>
        <label>
          <span>Название внутри Radar</span>
          <input name="displayName" placeholder="VK агентства" maxLength={120} />
        </label>
        <div className={styles.twoColumns}>
          <label>
            <span>ID сообщества</span>
            <input name="groupId" inputMode="numeric" placeholder="123456789" required />
          </label>
          <label>
            <span>Ключ доступа сообщества</span>
            <input name="token" type="password" autoComplete="off" required />
          </label>
        </div>
        <p className={styles.hint}>Нужны права на сообщения и управление Callback API. Радар попробует настроить сервер автоматически.</p>
        <FormSubmitButton idleLabel="Подключить VK" pendingLabel="Настраиваем Callback API..." className={styles.submit} />
      </form>
      <ActionFeedback state={state} />
    </details>
  );
}

function AddWebhookForm() {
  const [state, action] = useActionState(addWebhookNotificationAction, null);
  return (
    <details className={styles.addCard}>
      <summary>
        <span className={styles.providerIcon}>API</span>
        <span><strong>Webhook / n8n</strong><small>Универсальная доставка в CRM и автоматизации</small></span>
      </summary>
      <form action={action} className={styles.form}>
        <label>
          <span>Название</span>
          <input name="displayName" placeholder="n8n — горячие лиды" maxLength={120} />
        </label>
        <label>
          <span>HTTPS URL</span>
          <input name="url" type="url" placeholder="https://n8n.example.com/webhook/radar" required />
        </label>
        <p className={styles.hint}>Каждый запрос подписывается HMAC-SHA256 и содержит event id + Idempotency-Key.</p>
        <FormSubmitButton idleLabel="Подключить webhook" pendingLabel="Проверяем URL..." className={styles.submit} />
      </form>
      <ActionFeedback state={state} />
    </details>
  );
}

function ConnectionCard({ connection }: { connection: NotificationConnection }) {
  const [bindState, bindAction] = useActionState(createNotificationBindingAction, null);
  const [reconcileState, reconcileAction] = useActionState(reconcileVkNotificationAction, null);
  const [testState, testAction] = useActionState(testNotificationConnectionAction, null);
  const [disconnectState, disconnectAction] = useActionState(disconnectNotificationConnectionAction, null);
  const activeEndpoints = connection.endpoints.filter((endpoint) => endpoint.status === "active");
  const needsBinding = connection.provider !== "webhook" && activeEndpoints.length === 0;
  const needsVkRecovery = connection.provider === "vk" && connection.status === "degraded";

  return (
    <article className={styles.connectionCard}>
      <div className={styles.connectionHead}>
        <div>
          <span className={styles.eyebrow}>{PROVIDER_LABELS[connection.provider]}</span>
          <h3>{connection.displayName}</h3>
          <p>{connection.externalAccountName ?? "Подключённый канал"}</p>
        </div>
        <span className={`${styles.status} ${connection.status === "active" ? styles.statusOk : styles.statusWarn}`}>
          {STATUS_LABELS[connection.status] ?? connection.status}
        </span>
      </div>

      <div className={styles.endpointList}>
        {connection.endpoints.length === 0 ? <span>Точки доставки ещё не созданы.</span> : null}
        {connection.endpoints.map((endpoint) => (
          <div key={endpoint.id} className={styles.endpointRow}>
            <span>{endpoint.destinationLabel ?? (endpoint.status === "pending_bind" ? "Ожидает привязки" : endpoint.endpointType)}</span>
            <small>{endpoint.status === "active" ? "Активна" : endpoint.status}</small>
          </div>
        ))}
      </div>

      {connection.lastErrorMessage ? <p className={styles.errorText}>{connection.lastErrorMessage}</p> : null}

      <div className={styles.actions}>
        {needsVkRecovery ? (
          <form action={reconcileAction}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <FormSubmitButton idleLabel="Повторить настройку VK" pendingLabel="Настраиваем..." className={styles.secondaryButton} />
          </form>
        ) : null}
        {needsBinding ? (
          <form action={bindAction}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <FormSubmitButton
              idleLabel={connection.provider === "telegram" ? "Получить ссылку" : "Получить код"}
              pendingLabel="Создаём..."
              className={styles.secondaryButton}
            />
          </form>
        ) : (
          <form action={testAction}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <FormSubmitButton idleLabel="Отправить тест" pendingLabel="Отправляем..." className={styles.secondaryButton} />
          </form>
        )}
        <form action={disconnectAction}>
          <input type="hidden" name="connectionId" value={connection.id} />
          <FormSubmitButton idleLabel="Отключить" pendingLabel="Отключаем..." className={styles.dangerButton} />
        </form>
      </div>
      <ActionFeedback state={reconcileState} />
      <ActionFeedback state={needsBinding ? bindState : testState} />
      <ActionFeedback state={disconnectState} />
    </article>
  );
}

export function NotificationChannels({ connections }: { connections: NotificationConnection[] }) {
  return (
    <section className={styles.root} aria-labelledby="notification-channels-title">
      <div className={styles.intro}>
        <div>
          <span className={styles.eyebrow}>Система уведомлений</span>
          <h2 id="notification-channels-title">Куда отправлять новые компании</h2>
          <p>Подключите собственные каналы агентства. Токены шифруются, а каждая доставка записывается с защитой от дублей.</p>
        </div>
        <span className={styles.count}>{connections.length} подключено</span>
      </div>

      <div className={styles.addGrid}>
        <AddTelegramForm />
        <AddVkForm />
        <AddWebhookForm />
      </div>

      <div className={styles.connections}>
        {connections.length === 0 ? (
          <div className={styles.empty}>
            <strong>Пока используется стандартная доставка</strong>
            <span>Подключите первый собственный канал. Старый Telegram останется fallback до успешной привязки нового.</span>
          </div>
        ) : connections.map((connection) => (
          <ConnectionCard key={connection.id} connection={connection} />
        ))}
      </div>
    </section>
  );
}
