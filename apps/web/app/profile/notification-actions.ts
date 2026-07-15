"use server";

import { revalidatePath } from "next/cache";

import { getClientProfileByOwnerId } from "../../lib/clientProfiles";
import {
  createTelegramNotificationConnectionSafely,
  createVkNotificationConnectionSafely,
  disconnectNotificationConnectionSafely,
} from "../../lib/notification-connection-operations";
import { redactProviderSecret } from "../../lib/notification-secrets";
import { reconcileVkNotificationConnection } from "../../lib/notification-vk-reconcile";
import {
  createNotificationBindingInstructions,
  createWebhookNotificationConnection,
  testNotificationConnection,
} from "../../lib/notifications";
import { readOwnerSession } from "../../lib/session";

export type NotificationActionResult = {
  ok: boolean;
  message: string;
  privateLink?: string;
  groupLink?: string;
  connectCommand?: string;
  signingSecret?: string;
  callbackConfigured?: boolean;
};

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function safeError(error: unknown, fallback: string): NotificationActionResult {
  const message = error instanceof Error ? error.message : fallback;
  return { ok: false, message: redactProviderSecret(message) };
}

async function ownerContext() {
  const ownerId = await readOwnerSession();
  if (!ownerId) throw new Error("Требуется вход в аккаунт.");
  const profile = await getClientProfileByOwnerId(ownerId);
  if (!profile) throw new Error("Профиль не найден. Сначала активируйте радар.");
  return { ownerId, profile };
}

function refreshNotificationPages() {
  revalidatePath("/profile");
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

export async function addTelegramNotificationAction(
  _previous: NotificationActionResult | null,
  formData: FormData,
): Promise<NotificationActionResult> {
  try {
    const { ownerId, profile } = await ownerContext();
    const botToken = text(formData, "botToken");
    if (!botToken) return { ok: false, message: "Вставьте токен бота из BotFather." };
    const created = await createTelegramNotificationConnectionSafely({
      ownerId,
      clientProfileId: profile.id,
      botToken,
      displayName: text(formData, "displayName"),
    });
    refreshNotificationPages();
    return {
      ok: true,
      message: "Telegram-бот проверен, webhook настроен. Осталось выбрать чат.",
      privateLink: created.privateLink,
      groupLink: created.groupLink,
    };
  } catch (error) {
    return safeError(error, "Не удалось подключить Telegram-бота.");
  }
}

export async function addVkNotificationAction(
  _previous: NotificationActionResult | null,
  formData: FormData,
): Promise<NotificationActionResult> {
  try {
    const { ownerId, profile } = await ownerContext();
    const groupId = text(formData, "groupId");
    const token = text(formData, "token");
    if (!groupId || !token) {
      return { ok: false, message: "Укажите ID сообщества и ключ доступа сообщества." };
    }
    const created = await createVkNotificationConnectionSafely({
      ownerId,
      clientProfileId: profile.id,
      groupId,
      token,
      displayName: text(formData, "displayName"),
    });

    let callbackConfigured = created.callbackConfigured;
    if (!callbackConfigured) {
      try {
        await reconcileVkNotificationConnection({
          ownerId,
          connectionId: created.connectionId,
        });
        callbackConfigured = true;
      } catch {
        callbackConfigured = false;
      }
    }

    refreshNotificationPages();
    return {
      ok: true,
      message: callbackConfigured
        ? "VK Callback API настроен. Отправьте команду сообществу для привязки диалога."
        : "Сообщество сохранено, но Callback API пока не настроен. Проверьте права ключа и нажмите «Повторить настройку VK».",
      connectCommand: created.connectCommand,
      callbackConfigured,
    };
  } catch (error) {
    return safeError(error, "Не удалось подключить VK-сообщество.");
  }
}

export async function addWebhookNotificationAction(
  _previous: NotificationActionResult | null,
  formData: FormData,
): Promise<NotificationActionResult> {
  try {
    const { ownerId, profile } = await ownerContext();
    const url = text(formData, "url");
    if (!url) return { ok: false, message: "Укажите URL webhook." };
    const created = await createWebhookNotificationConnection({
      ownerId,
      clientProfileId: profile.id,
      url,
      displayName: text(formData, "displayName"),
    });
    refreshNotificationPages();
    return {
      ok: true,
      message: "Webhook подключён. Сохраните секрет: повторно он не показывается.",
      signingSecret: created.signingSecret,
    };
  } catch (error) {
    return safeError(error, "Не удалось подключить webhook.");
  }
}

export async function createNotificationBindingAction(
  _previous: NotificationActionResult | null,
  formData: FormData,
): Promise<NotificationActionResult> {
  try {
    const { ownerId } = await ownerContext();
    const connectionId = text(formData, "connectionId");
    if (!connectionId) return { ok: false, message: "Канал не выбран." };
    const instructions = await createNotificationBindingInstructions({ ownerId, connectionId });
    return {
      ok: true,
      message: "Одноразовая ссылка действует 30 минут.",
      privateLink: instructions.privateLink,
      groupLink: instructions.groupLink,
      connectCommand: instructions.connectCommand,
    };
  } catch (error) {
    return safeError(error, "Не удалось создать ссылку подключения.");
  }
}

export async function reconcileVkNotificationAction(
  _previous: NotificationActionResult | null,
  formData: FormData,
): Promise<NotificationActionResult> {
  try {
    const { ownerId } = await ownerContext();
    const connectionId = text(formData, "connectionId");
    if (!connectionId) return { ok: false, message: "VK-канал не выбран." };
    await reconcileVkNotificationConnection({ ownerId, connectionId });
    refreshNotificationPages();
    return { ok: true, message: "VK Callback API настроен." };
  } catch (error) {
    return safeError(error, "Не удалось настроить VK Callback API.");
  }
}

export async function testNotificationConnectionAction(
  _previous: NotificationActionResult | null,
  formData: FormData,
): Promise<NotificationActionResult> {
  try {
    const { ownerId } = await ownerContext();
    const connectionId = text(formData, "connectionId");
    await testNotificationConnection({ ownerId, connectionId });
    refreshNotificationPages();
    return { ok: true, message: "Тестовое уведомление отправлено." };
  } catch (error) {
    return safeError(error, "Тестовая отправка не удалась.");
  }
}

export async function disconnectNotificationConnectionAction(
  _previous: NotificationActionResult | null,
  formData: FormData,
): Promise<NotificationActionResult> {
  try {
    const { ownerId } = await ownerContext();
    const connectionId = text(formData, "connectionId");
    const disconnected = await disconnectNotificationConnectionSafely({ ownerId, connectionId });
    refreshNotificationPages();
    return {
      ok: true,
      message: disconnected.cleanupWarning
        ? `Канал отключён в Recruiter Radar. Provider hook не удалось снять автоматически: ${disconnected.cleanupWarning}`
        : "Канал отключён, provider-side webhook удалён.",
    };
  } catch (error) {
    return safeError(error, "Не удалось отключить канал.");
  }
}
