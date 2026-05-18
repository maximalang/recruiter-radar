export type WebPushConnectLinkState = {
  configured: boolean;
  publicKey: string | null;
  connectToken: string | null;
  helperLabel: string;
};

export function getWebPushConnectLinkState(input: {
  orderId: string;
  clientProfileId: string;
}): WebPushConnectLinkState {
  void input;

  return {
    configured: false,
    publicKey: null,
    connectToken: null,
    helperLabel: "Web push будет доступен позже."
  };
}
