# Stage 1: Builder
FROM node:22-alpine AS builder

WORKDIR /app

ARG NEXT_PUBLIC_YANDEX_METRIKA_ID=""
ENV NEXT_PUBLIC_YANDEX_METRIKA_ID=$NEXT_PUBLIC_YANDEX_METRIKA_ID

# Copy package files for better layer caching
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY packages/db/package*.json ./packages/db/

# Install dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build --workspace @recruiter-radar/web

# Stage 2: Runner
FROM node:22-alpine AS runner

WORKDIR /app

# Playwright uses the distribution Chromium in production. Browser downloads
# are intentionally not persisted from the builder's node_modules cache.
# EIS and Rosstat currently use the official Russian government TLS chain,
# published at https://www.gosuslugi.ru/crt. Install the fingerprint-pinned
# root and current intermediate for both the Alpine/Chromium trust store and
# Node's documented extra-CA path; certificate verification remains enabled.
COPY packages/db/certs/russian-trusted-root-ca.pem /usr/local/share/ca-certificates/russian-trusted-root-ca.crt
COPY packages/db/certs/russian-trusted-sub-ca-2024.pem /usr/local/share/ca-certificates/russian-trusted-sub-ca-2024.crt
RUN apk add --no-cache ca-certificates chromium nss-tools \
  && update-ca-certificates \
  && cat /usr/local/share/ca-certificates/russian-trusted-root-ca.crt \
    /usr/local/share/ca-certificates/russian-trusted-sub-ca-2024.crt \
    > /etc/ssl/certs/russian-trusted-ca-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/russian-trusted-ca-bundle.pem
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Chromium on Linux reads explicitly installed local trust from the user's NSS
# Shared DB. M146+ uses .local/share/pki; the legacy location remains populated
# for older distro Chromium versions. The intermediate is imported without
# root trust, while only the pinned root receives SSL CA trust.
RUN for nssdb in /home/nextjs/.local/share/pki/nssdb /home/nextjs/.pki/nssdb; do \
    mkdir -p "$nssdb" \
    && certutil -d "sql:$nssdb" -N --empty-password \
    && certutil -d "sql:$nssdb" -A -t 'C,,' -n 'Russian Trusted Root CA' -i /usr/local/share/ca-certificates/russian-trusted-root-ca.crt \
    && certutil -d "sql:$nssdb" -A -t ',,' -n 'Russian Trusted Sub CA 2024' -i /usr/local/share/ca-certificates/russian-trusted-sub-ca-2024.crt; \
  done \
  && chown -R nextjs:nodejs /home/nextjs \
  && apk del nss-tools
ENV HOME=/home/nextjs

# Copy the standalone server, Next static files, and public assets.
# Next.js standalone output does not include public/ automatically.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

# Query Planner keeps HH outside the default allowlist, but an explicitly
# approved HH run still needs its proxy stack in the standalone image.
COPY --from=builder /app/node_modules/socks ./node_modules/socks
COPY --from=builder /app/node_modules/ip-address ./node_modules/ip-address
COPY --from=builder /app/node_modules/smart-buffer ./node_modules/smart-buffer
COPY --from=builder /app/node_modules/undici ./node_modules/undici

# Copy migration tooling for startup migrations
COPY --from=builder /app/packages/db/scripts/migrate.mjs ./packages/db/scripts/migrate.mjs
COPY --from=builder /app/packages/db/scripts/reconcile-payment-success-telemetry.mjs ./packages/db/scripts/reconcile-payment-success-telemetry.mjs
COPY --from=builder /app/packages/db/scripts/verify-hh-live-pipeline.mjs ./packages/db/scripts/verify-hh-live-pipeline.mjs
COPY --from=builder /app/packages/db/schema ./packages/db/schema
COPY --from=builder /app/packages/db/migrations ./packages/db/migrations

# The Commercial Signal route launches this script as a child process. Import
# its default path and every import-safe HH runtime dependency in the final
# image. The CLI itself executes at module load, so assert its traced path and
# import the adapter + lineage writer separately; missing standalone files or
# dependencies then fail the image build rather than a production run.
RUN node --input-type=module -e "const { accessSync } = await import('node:fs'); accessSync('./packages/db/scripts/ingest-hh.mjs'); accessSync('./packages/db/scripts/verify-hh-live-pipeline.mjs'); await import('./packages/db/scripts/execute-query-planner-v2.mjs'); await import('./packages/db/scripts/adapters/hh.mjs'); await import('./packages/db/scripts/lib/source-lineage-writer.mjs')"

# Startup script: run migrations, then start server
COPY --from=builder /app/apps/web/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Set ownership
RUN chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the application (via entrypoint that runs migrations first)
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV PUBLIC_APP_ORIGIN="https://recruiter-radar.ru"

CMD ["./docker-entrypoint.sh"]
