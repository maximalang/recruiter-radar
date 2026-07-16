# Notification delivery platform

## Scope

Recruiter Radar can deliver a digest through customer-managed Telegram bots, VK communities, signed webhooks/n8n, email and browser push.

The notification domain is intentionally separated into:

1. `notification_provider_accounts` — provider identity and encrypted credentials.
2. `notification_endpoints` — a concrete Telegram chat, VK peer or webhook URL.
3. `notification_routes` — event and filtering policy for an endpoint.
4. `notification_delivery_jobs` / `notification_delivery_attempts` — idempotent durable delivery history.
5. `notification_inbound_events` — replay-safe provider callbacks.
6. `notification_audit_log` — owner and system changes.

The legacy shared Telegram bot remains a fallback until a profile has an active customer-managed Telegram endpoint.

## Production setup

Run migrations:

```bash
npm run db:migrate
```

Generate a dedicated encryption key once and store it in the deployment secret manager:

```bash
openssl rand -base64 32
```

Set:

```dotenv
NOTIFICATION_ENCRYPTION_KEY=<32-byte base64 key>
NEXT_PUBLIC_APP_URL=https://recruiter-radar.ru
```

`NOTIFICATION_ENCRYPTION_KEY` may also be 64 hexadecimal characters. During rollout, a strong `SESSION_SECRET` is accepted as a compatibility fallback, but production should use a dedicated key before customers save provider credentials.

The public app URL must be HTTPS because Telegram and VK send callbacks to:

```text
/api/notifications/telegram/{publicId}
/api/notifications/vk/{publicId}
```

## Telegram BYOB flow

1. The customer creates a bot in BotFather.
2. In **Profile → Notification channels**, the customer pastes the bot token.
3. Recruiter Radar calls `getMe`, encrypts the token and configures a webhook with a unique secret.
4. Recruiter Radar creates a one-time 30-minute bind token.
5. The customer opens the personal-chat link or the group link.
6. The provider callback binds the actual `chat_id` to the endpoint.
7. The customer sends a test notification from the profile.

A configured customer bot replaces the legacy shared bot only after the endpoint becomes active. If no active customer endpoint exists, the existing shared-bot path is unchanged.

## VK community flow

The community token must be able to read community information, send messages and manage Callback API settings.

1. Enter the numeric community ID and community access token.
2. Recruiter Radar verifies the community and obtains the callback confirmation code.
3. Recruiter Radar attempts to create and enable a Callback API server automatically.
4. The customer sends the generated `/connect <token>` command to the community.
5. The incoming `message_new` event binds its `peer_id`.
6. The customer sends a test notification.

If automatic callback setup is rejected, the connection is marked `degraded`. Check token permissions, remove an obsolete callback server if the VK limit was reached, and reconnect.

## Generic webhook / n8n

A webhook receives JSON with these headers:

```text
Content-Type: application/json
X-Radar-Event: digest.ready
X-Radar-Event-Id: job_<uuid>
X-Radar-Timestamp: <ISO-8601>
X-Radar-Signature: sha256=<hex HMAC-SHA256>
Idempotency-Key: job_<uuid>
```

The signature is calculated over the exact raw request body with the one-time secret shown after connection:

```text
hex(hmac_sha256(signing_secret, raw_body))
```

Consumers must verify the signature before parsing or acting on the payload and retain `Idempotency-Key` values to reject duplicate processing.

## Delivery semantics

- A job key is deterministic for `(digest run, route, endpoint, route version)`.
- A successful job is never reclaimed.
- Failed, queued, or stale `sending` jobs may be reclaimed.
- VK `random_id` is derived from the job ID, so retries do not create a second message.
- Permanent and authentication errors move the job to `dead_letter` immediately.
- Retryable errors move to `failed`; after five attempts the job moves to `dead_letter`.
- Provider credentials and full tokens must never be written to logs or error responses.

## Recovery

### Telegram token revoked

1. Disconnect the affected channel in the profile.
2. Revoke or regenerate the token in BotFather.
3. Connect the bot again and bind the target chat.
4. Send a test notification.

The profile uses the shared Telegram fallback while no active customer-managed Telegram endpoint exists.

### Telegram webhook drift

Reconnect the bot from the profile. The connection flow calls `setWebhook` again with the expected callback URL and secret.

### VK callback unavailable

Check the community token permissions and callback-server limits. Disconnect and reconnect after correcting permissions.

### Dead-letter delivery

Inspect:

```sql
SELECT j.*, a.provider_error_code, a.provider_error_message
FROM notification_delivery_jobs j
LEFT JOIN LATERAL (
  SELECT *
  FROM notification_delivery_attempts
  WHERE job_id = j.id
  ORDER BY attempt_no DESC
  LIMIT 1
) a ON TRUE
WHERE j.status = 'dead_letter'
ORDER BY j.failed_at DESC;
```

Correct the provider account or endpoint configuration before replaying. Do not create a new route solely to bypass an existing failed idempotency key.

## Rollback

Application rollback is safe because the migration only adds new tables and the existing `client_profiles` delivery fields are retained. Reverting the application returns all profiles to the legacy Telegram/email/web-push behavior. Do not drop notification tables until encrypted credentials and delivery history are no longer required.
