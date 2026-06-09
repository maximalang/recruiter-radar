# Stage 1: Builder
FROM node:22-alpine AS builder

WORKDIR /app

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

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Copy only the build output and necessary files
# Standalone output includes node_modules/pg and all transitive deps
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./.next/static

# Copy migration tooling for startup migrations
COPY --from=builder /app/packages/db/scripts/migrate.mjs ./packages/db/scripts/migrate.mjs
COPY --from=builder /app/packages/db/schema ./packages/db/schema
COPY --from=builder /app/packages/db/migrations ./packages/db/migrations

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

CMD ["./docker-entrypoint.sh"]
