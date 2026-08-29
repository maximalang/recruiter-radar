import { isAuthorizedTelegramCallbackOrigin } from '../../../lib/telegram-callback-authorization';

describe('Telegram callback origin authorization', () => {
  it('allows only the bound actor in the bound private chat', () => {
    expect(
      isAuthorizedTelegramCallbackOrigin({
        endpointType: 'telegram_private_chat',
        destinationId: '42',
        chatId: '42',
        actorId: '42',
      }),
    ).toBe(true);
  });

  it.each([
    ['group endpoint', 'telegram_group', '42', '42', '42'],
    ['channel endpoint', 'telegram_channel', '42', '42', '42'],
    ['wrong chat', 'telegram_private_chat', '42', '43', '43'],
    ['wrong actor', 'telegram_private_chat', '42', '42', '99'],
    ['missing origin', 'telegram_private_chat', '42', null, '42'],
  ])('%s fails closed', (_label, endpointType, destinationId, chatId, actorId) => {
    expect(
      isAuthorizedTelegramCallbackOrigin({
        endpointType,
        destinationId,
        chatId,
        actorId,
      }),
    ).toBe(false);
  });
});
