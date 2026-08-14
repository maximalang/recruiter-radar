# N8N Setup Guide

> Historical/manual templates only. n8n is not a production scheduler authority.
> Do not activate HH Daily, Career Pages Daily, or Digest Delivery schedules;
> repository-controlled GitHub Actions own all production source and delivery clocks.

## Workflows Overview

### 1. HH Daily Pipeline (`hh-daily.json`)
- **Status**: archived compatibility template; keep inactive
- **Historical schedule**: 06:00 MSK daily
- **Purpose**: Runs `npm run source:pipeline:hh` to fetch and ingest HH vacancies
- **Notifications**: Success message or Telegram alert on failure

### 2. Career Pages Daily Pipeline (`career-pages-daily.json`)
- **Status**: archived compatibility template; keep inactive
- **Historical schedule**: 07:00 MSK daily
- **Purpose**: Runs career pages pipeline with smoke targets
- **Notifications**: Success message or Telegram alert on failure

### 3. Digest Delivery (`daily-signals.json`)
- **Schedule**: Runs on manual trigger or via API
- **Purpose**: Calls `/api/digest/delivery` to send digests
- **Retry Logic**: 3 retries with 2s delay

### 4. Operational Alerts (`operational-alerts.json`)
- **Trigger**: Manual or webhook
- **Purpose**: Send alerts to operator channels
- **Channels**: Telegram and Slack

## Environment Variables Required

```bash
# For n8n instance
TELEGRAM_OPERATOR_CHANNEL_ID=telegram_channel_id
SLACK_OPERATOR_CHANNEL=slack_channel_name

# For recruiter-radar app
DATABASE_URL=postgres://user:pass@host:port/db
DIGEST_API_KEY=your-secret-key
RR_APP_BASE_URL=https://your-domain.com
```

## Deployment Steps

1. **Import Workflows**
   - Upload all JSON files to n8n instance
   - Set environment variables in n8n settings

2. **Test Execution**
   - Run workflows manually first
   - Check notifications are delivered

3. **Production safety**
   - Do not activate any scheduled trigger from these templates
   - Use the repository-controlled GitHub Actions workflows instead

## Monitoring

- Check execution history in n8n UI
- Monitor operator channels for alerts
- Review logs for errors

## Security Notes

- Never commit secrets to workflow exports
- Use credential management in n8n
- Restrict n8n instance access
