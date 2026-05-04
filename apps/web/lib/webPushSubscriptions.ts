export type ClientProfileWebPushStatus = {
  configured: boolean;
  activeSubscriptionCount: number;
  stateLabel: string;
  helperLabel: string;
};

export async function getClientProfileWebPushStatuses(input: {
  clientProfileIds: readonly string[];
}): Promise<Map<string, ClientProfileWebPushStatus>> {
  const result = new Map<string, ClientProfileWebPushStatus>();

  for (const clientProfileId of input.clientProfileIds) {
    result.set(clientProfileId, {
      configured: false,
      activeSubscriptionCount: 0,
      stateLabel: "не подключён",
      helperLabel: "Web push ещё не настроен."
    });
  }

  return result;
}
