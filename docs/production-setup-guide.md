# Production Setup Guide for Recruiter Radar

## 🚀 Quick Start

This guide helps you set up Recruiter Radar for production operation.

### ✅ Step 1: HH.ru application authorization

Recruiter Radar uses HH application authorization for the vacancy source.

Use this application identity for production requests:

```bash
HH_USER_AGENT=RecruiterRadar/1.0 (support@recruiter-radar.ru)
```

`HH_USER_AGENT` is not a secret. HH expects an application name and a monitored developer contact. Do not append the Client ID to this value.

HH supports two runtime modes in Recruiter Radar:

#### Preferred production mode — pre-issued application token

Generate the application access token once from the registered application's Client ID and Client Secret, then store the returned token as a secret:

```bash
HH_ACCESS_TOKEN=<application-access-token>
```

When `HH_ACCESS_TOKEN` is present, Recruiter Radar uses it directly and does not request a new application token on startup.

#### Bootstrap/recovery mode — Client ID + Client Secret

```bash
HH_CLIENT_ID=<client-id>
HH_CLIENT_SECRET=<client-secret>
```

Recruiter Radar can request the application token itself when no `HH_ACCESS_TOKEN` is supplied. `HH_CLIENT_ID` and `HH_CLIENT_SECRET` must always be configured together.

For production, prefer the pre-issued token because HH application tokens have unlimited lifetime and requesting a new one revokes the previous token. Keep Client ID and Client Secret in the secret store for controlled bootstrap/recovery, not in git.

To issue the token manually without putting credentials in shell history as command arguments:

```bash
read -r -p 'HH_CLIENT_ID: ' HH_CLIENT_ID
read -r -s -p 'HH_CLIENT_SECRET: ' HH_CLIENT_SECRET; echo
export HH_CLIENT_ID HH_CLIENT_SECRET

curl -sS -X POST 'https://api.hh.ru/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'HH-User-Agent: RecruiterRadar/1.0 (support@recruiter-radar.ru)' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode "client_id=$HH_CLIENT_ID" \
  --data-urlencode "client_secret=$HH_CLIENT_SECRET"
```

The JSON response contains `access_token`; store that value as `HH_ACCESS_TOKEN`. Do not generate another token unless the current one must be rotated or was compromised.

### 🔐 Step 2: Provider Tokens Setup

#### Required for Production

```bash
# LinkedIn Company Pages
LINKEDIN_PROVIDER_API_URL=https://api.linkedin.com/v2
LINKEDIN_PROVIDER_API_TOKEN=your_linkedin_api_token

# SuperJob
SUPERJOB_PROVIDER_API_URL=https://api.superjob.ru/2.0
SUPERJOB_API_APP_ID=your_superjob_app_id

# Habr Career
HABR_CAREER_PROVIDER_API_URL=https://career.habr.com/api
HABR_CAREER_PROVIDER_API_TOKEN=your_habr_career_token

# Transparent Business/FNS
TRANSPARENT_BUSINESS_FNS_PROVIDER_API_URL=https://api.transparentbusiness.ru
TRANSPARENT_BUSINESS_FNS_PROVIDER_API_TOKEN=your_tb_token

# Fedresurs
FEDRESURS_PROVIDER_API_URL=https://api.fedresurs.ru
FEDRESURS_PROVIDER_API_TOKEN=your_fedresurs_token

# Company Newsrooms
COMPANY_NEWSROOMS_PROVIDER_API_URL=https://api.prnewswire.com
COMPANY_NEWSROOMS_PROVIDER_API_TOKEN=your_prnewswire_token

# Industry Media (optional provider override; public curated feeds are default)
INDUSTRY_MEDIA_PROVIDER_API_URL=https://provider.example/api
INDUSTRY_MEDIA_PROVIDER_API_TOKEN=your_provider_token
```

### 📋 Step 3: Database Configuration

```bash
DATABASE_URL=postgresql://user:password@host:port/database
POSTGRES_DB=recruiter_radar
POSTGRES_USER=your_db_user
POSTGRES_PASSWORD=your_secure_password
DB_CONNECTION_TIMEOUT_MS=30000
```

### 🔑 Step 4: Session Security

```bash
SESSION_SECRET=your_random_session_secret_here_at_least_32_chars
SESSION_SECURE_COOKIE=true
```

### 📡 Step 5: Telegram Integration

```bash
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_BOT_USERNAME=your_bot_username
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_WEBHOOK_SECRET=your_webhook_secret
```

## 🎯 Production Readiness Checklist

### Environment Variables
- [x] `HH_USER_AGENT` — `RecruiterRadar/1.0 (support@recruiter-radar.ru)`
- [ ] `HH_ACCESS_TOKEN` **or** both `HH_CLIENT_ID` + `HH_CLIENT_SECRET`
- [ ] Provider tokens for enabled credential-gated sources
- [ ] Database connection
- [ ] Session secret
- [ ] Telegram bot config

### HH verification
- [ ] `npm run verify:hh:oauth-smoke`
- [ ] `npm run verify:hh:smoke`
- [ ] Run the isolated authenticated live pipeline verifier against a disposable database
- [ ] Confirm HH signal → evidence → lineage persistence before marking HH live-verified

### Source Readiness
- [ ] Run `npm run verify:sources:readiness`
- [ ] Run `npm run verify:sources:coverage`
- [ ] Run `npm run verify:sources:live-config`

### Testing
- [ ] Test HH pipeline: `npm run source:pipeline:hh`
- [ ] Test career-pages pipeline: `npm run source:pipeline:career-pages`
- [ ] Verify no TypeScript errors: `npm run web:check`

## 🚨 Important Notes

1. **HH credentials**: store `HH_ACCESS_TOKEN`, `HH_CLIENT_ID`, and `HH_CLIENT_SECRET` only in production secret storage; never commit real values.
2. **HH application token**: do not rotate it on each refresh job or restart.
3. **Provider Tokens**: store securely. Never commit to git.
4. **Session Secret**: generate a dedicated production value.
5. **HTTPS**: set `SESSION_SECURE_COOKIE=true` in production.

## 🔧 Optional HH Search Configuration

```bash
HH_SEARCH_TEXT=рекрутер
HH_AREA=1
HH_PER_PAGE=100
HH_PAGES=5
```

## 📞 Support

For operational issues:
1. Check source refresh logs.
2. Run the HH smoke verifier.
3. Review source readiness/status output.
4. For HH API-specific issues, preserve the HTTP status and HH `errors[].type/value` without logging credentials or bearer tokens.
