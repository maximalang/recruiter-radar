import { getWebPushPublicKey, isWebPushConfigured } from "./webPush";

export type WebPushConnectLinkState = {
  configured: boolean;
  publicKey: string | null;
  /**
   * Reserved for parity with the Telegram connect flow. Web-push subscribes
   * through the authenticated session, not a connect token, so this is always
   * null. Kept on the type so existing callers / props need no signature change.
   */
  connectToken: string | null;
  helperLabel: string;
};

/**
 * Server-side state for the browser-push opt-in card. Exposes the public VAPID
 * key (needed by the browser to subscribe) when web-push is configured.
 */
export function getWebPushConnectLinkState(input: {
  orderId: string;
  clientProfileId: string;
}): WebPushConnectLinkState {
  void input;

  const configured = isWebPushConfigured();

  return {
    configured,
    publicKey: configured ? getWebPushPublicKey() : null,
    connectToken: null,
    helperLabel: configured
      ? "Получайте мгновенные сигналы о новых сильных лидах прямо в браузере."
      : "Web push будет доступен позже."
  };
}
