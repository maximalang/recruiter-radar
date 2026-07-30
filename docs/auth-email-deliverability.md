# Auth email deliverability checklist

This is the production-readiness gate for passwordless login and account
security notifications. It documents verification only: DNS, payment, and
provider-account changes are intentionally outside the Auth Platform v2 pull
requests.

## Sender identity

- [ ] `AUTH_SITE_URL` is the canonical HTTPS product origin. Authentication
  links use its `/auth/verify#…` fragment and never put an email, token, or
  other personal data in query parameters.
- [ ] `SMTP_FROM` is a stable address on the authenticated sending domain,
  uses the Recruiter Radar display name, and is accepted by the SMTP provider.
- [ ] `SMTP_REPLY_TO` is either absent or a monitored corporate mailbox. It
  must not be a no-reply sink when the email asks the recipient to contact
  support.
- [ ] A seed message shows the expected `From`, `Reply-To`, `Return-Path`, and
  canonical HTTPS links in both HTML and plain-text clients.

## Domain authentication

- [ ] SPF has exactly one effective record and authorizes the actual sending
  provider without exceeding the DNS lookup limit.
- [ ] DKIM signing is enabled for the exact `From` domain; a received seed
  message reports a passing aligned signature.
- [ ] DMARC exists for the `From` domain. Start with monitored policy and
  aggregate reports, confirm alignment, then tighten policy through the normal
  infrastructure-change process.
- [ ] A seed message inspected outside the provider reports SPF, DKIM, and
  DMARC as passing. Keep the raw headers as release evidence without recipient
  addresses or tokens.

## Bounce, retry, and abuse handling

- [ ] The provider's bounce/complaint webhook is authenticated, idempotent, and
  stores only the minimum delivery metadata. Hard bounces and complaints enter
  suppression immediately.
- [ ] Transient SMTP failures use a bounded provider-side retry policy with
  exponential backoff. The application does not blindly retry an ambiguous
  accepted send, which could duplicate a one-time login email.
- [ ] Authentication request and resend rate limits remain authoritative even
  when delivery fails. The UI response stays generic and never reveals whether
  an account exists.
- [ ] Alerts cover sustained send failures, bounce spikes, complaint spikes,
  and provider queue delay without logging recipient addresses or login links.

## Content and client verification

- [ ] Every auth event has an escaped branded HTML template and an equivalent
  plain-text part.
- [ ] Templates have no tracking pixel, remote image, marketing consent, or
  promotional content.
- [ ] Login, email-change, invite, and deletion actions state their expiry and
  include a clear security notice.
- [ ] Seed tests cover major desktop and mobile clients, dark mode, disabled
  images, long workspace/device labels, and links copied from plain text.
- [ ] The deterministic test outbox is used only outside production, writes to
  an absolute temporary path, and is deleted after E2E verification because it
  contains one-time test links.
