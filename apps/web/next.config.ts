import type { NextConfig } from "next";

export function buildContentSecurityPolicy(environment: string | undefined): string {
  const isDevelopment = environment !== 'production';
  const scriptPolicy = isDevelopment
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";
  const connectPolicy = isDevelopment
    ? "connect-src 'self' ws: https://telegram.org"
    : "connect-src 'self' https://telegram.org";

  return `default-src 'self'; ${scriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; ${connectPolicy}; frame-ancestors 'none'`;
}

const nextConfig: NextConfig = {
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
