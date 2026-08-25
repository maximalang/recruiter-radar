export function isAuthorizedTelegramCallbackOrigin(input: {
  endpointType: string;
  destinationId: string | null;
  chatId: string | null;
  actorId: string | null;
}): boolean {
  const destinationId = input.destinationId?.trim() || null;
  const chatId = input.chatId?.trim() || null;
  const actorId = input.actorId?.trim() || null;

  return (
    input.endpointType === 'telegram_private_chat' &&
    destinationId !== null &&
    chatId !== null &&
    actorId !== null &&
    destinationId === chatId &&
    actorId === chatId
  );
}
