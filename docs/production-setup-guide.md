# Production Setup Guide for Recruiter Radar

## 🚀 Quick Start

This guide helps you set up Recruiter Radar for production operation.

### ✅ Step 1: HH_USER_AGENT (Development Setup)

```bash
# Set in .env
HH_USER_AGENT=Recruiter-Radar/1.0 (https://recruiter-radar.ru; contact@recruiter-radar.ru)
```

**⚠️ Important**: This returns HTTP 403 in development because HH requires real app registration.

For production:
1. Go to https://hh.ru/dev/oauth
2. Register your application
3. Use the real Client ID in HH_USER_AGENT
4. Example: `HH_USER_AGENT=Recruiter-Radar/1.0 (https://recruiter-radar.ru; contact@recruiter-radar.ru) ClientID:12345`

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
# .env
DATABASE_URL=postgresql://user:password@host:port/database
POSTGRES_DB=recruiter_radar
POSTGRES_USER=your_db_user
POSTGRES_PASSWORD=your_secure_password
DB_CONNECTION_TIMEOUT_MS=30000
```

### 🔑 Step 4: Session Security

```bash
# Required: Generate a random 32+ character string
SESSION_SECRET=your_random_session_secret_here_at_least_32_chars
SESSION_SECURE_COOKIE=true  # Set to "false" for local HTTP dev only
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
- [x] `HH_USER_AGENT` - Set with proper app identity
- [ ] Provider tokens for all required sources
- [ ] Database connection
- [ ] Session secret
- [ ] Telegram bot config

### Source Readiness
- [ ] Run `npm run verify:sources:readiness`
- [ ] Run `npm run verify:sources:coverage`
- [ ] Run `npm run verify:sources:live-config`

### Testing
- [ ] Test HH pipeline: `npm run source:pipeline:hh`
- [ ] Test career-pages pipeline: `npm run source:pipeline:career-pages`
- [ ] Verify no TypeScript errors: `npm run web:check`

## 🚨 Important Notes

1. **HH_USER_AGENT**: Must be a real registered app. Placeholder may be rejected.
2. **Provider Tokens**: Store securely. Never commit to git.
3. **Session Secret**: Generate new secret for production deployment.
4. **HTTPS**: Set `SESSION_SECURE_COOKIE=true` in production.

## 🔧 Optional Configuration

### HH Search Parameters
```bash
# Customize HH search
HH_SEARCH_TEXT=рекрутер
HH_AREA=1  # Moscow
HH_PER_PAGE=100
HH_PAGES=5
```

### Career Pages Discovery
```bash
# Add your target companies
CAREER_PAGES_TARGETS_FILE=./targets/my-companies.json
CAREER_PAGES_DISCOVERY_LIMIT=1000
```

## 📞 Support

If you encounter issues:
1. Check logs in `n8n` workflows
2. Run verification scripts
3. Review source status with `npm run source:list`
