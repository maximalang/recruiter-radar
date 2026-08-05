import type { NextConfig } from "next";

const requestedE2eDistDir = process.env.AUTH_V2_E2E_DIST_DIR?.trim();
const distDir = (
  requestedE2eDistDir
  && /^\.next-auth-v2-e2e-[1-9]\d*$/.test(requestedE2eDistDir)
)
  ? requestedE2eDistDir
  : ".next";
const requestedE2eTsconfig = process.env.AUTH_V2_E2E_TSCONFIG?.trim();
const tsconfigPath = (
  requestedE2eTsconfig
  && /^\.auth-v2-e2e-tsconfig-[1-9]\d*\.json$/.test(requestedE2eTsconfig)
)
  ? requestedE2eTsconfig
  : "tsconfig.json";

const metrikaOrigins = "https://mc.yandex.ru https://mc.yandex.com";

export function buildContentSecurityPolicy(environment: string | undefined): string {
  const isDevelopment = environment !== 'production';
  const scriptPolicy = isDevelopment
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${metrikaOrigins}`
    : `script-src 'self' 'unsafe-inline' ${metrikaOrigins}`;
  const connectPolicy = isDevelopment
    ? `connect-src 'self' ws: https://telegram.org ${metrikaOrigins}`
    : `connect-src 'self' https://telegram.org ${metrikaOrigins}`;

  return `default-src 'self'; ${scriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; ${connectPolicy}; frame-ancestors 'none'`;
}

const nextConfig: NextConfig = {
  // Browser gates use a process-scoped cache so they never take the regular
  // developer server's `.next/dev` lock.
  distDir,
  devIndicators: distDir === ".next" ? undefined : false,
  typescript: { tsconfigPath },

  // Enable standalone output for Docker
  output: 'standalone',

  // Keep the browser runtime outside the server bundle. Routes that need SPA
  // rendering run on Node.js and register the engine only when Playwright is
  // importable.
  serverExternalPackages: ['playwright'],

  // Allow localhost development
  allowedDevOrigins: ["127.0.0.1"],

  // Security headers for production
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: buildContentSecurityPolicy(process.env.NODE_ENV),
          },
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
