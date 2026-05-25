import { NextResponse } from 'next/server';

/**
 * Health check endpoint for container orchestration and monitoring.
 * Returns 200 if the application is running and healthy.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || 'unknown',
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}