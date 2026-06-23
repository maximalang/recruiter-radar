# Cron trigger service for Recruiter Radar.
#
# A tiny image whose ONLY job is to run cron/trigger-daily-radar.mjs once,
# POST to the web service's daily-radar endpoint, and exit. Railway invokes
# it on a schedule (cronSchedule in cron/railway.toml) as a one-off container.
#
# Deliberately does NOT reuse apps/web/Dockerfile: that image ships only the
# Next.js standalone output, and building it (npm ci + next build) is far too
# heavy for a process that just makes one HTTP request. This builds in seconds.
FROM node:22-alpine

WORKDIR /app

# Run as the built-in non-root user.
USER node

# Only the trigger script is needed — global fetch, zero dependencies.
COPY --chown=node:node cron/trigger-daily-radar.mjs ./trigger-daily-radar.mjs

CMD ["node", "trigger-daily-radar.mjs"]
