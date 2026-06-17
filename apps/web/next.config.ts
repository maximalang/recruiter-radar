import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker
  output: 'standalone',

  // Crawlee and its browser backends are server-only and pull optional peers
  // (puppeteer/playwright) that aren't installed. Leave them as runtime
  // requires instead of bundling; the routes that reach them force
  // runtime='nodejs' and gate on isCrawleeAvailable() before use.
  serverExternalPackages: ['crawlee', '@crawlee/puppeteer', '@crawlee/playwright', 'puppeteer', 'playwright'],

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
            value: "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://telegram.org; frame-ancestors 'none'",
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
