import { NextRequest, NextResponse } from 'next/server'

/**
 * SuperJob OAuth callback stub.
 *
 * SuperJob's OAuth flow redirects here after user authorizes the app.
 * This project uses server-side API key auth (X-Api-App-Id) for vacancy
 * search — no user-level OAuth is needed. If SuperJob was registered with
 * this redirect_uri, it will hit here instead of 404ing.
 *
 * When user-level OAuth (for resume contacts) is implemented later,
 * replace this stub with a proper code→token exchange.
 */

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const error = request.nextUrl.searchParams.get('error')
  const state = request.nextUrl.searchParams.get('state')

  if (error) {
    return NextResponse.json(
      { error: error, error_description: request.nextUrl.searchParams.get('error_description') },
      { status: 400 },
    )
  }

  if (!code) {
    return NextResponse.json(
      { error: 'missing_code', message: 'SuperJob OAuth callback received without authorization code' },
      { status: 400 },
    )
  }

  // OAuth code received but no token exchange is configured yet.
  // Log the event and return a clear status so the caller knows
  // the callback was reached (no more 404).
  return NextResponse.json(
    {
      status: 'callback_received',
      message: 'SuperJob OAuth callback reached. User-level OAuth is not yet implemented — server-side API key auth is used for vacancy search.',
      has_code: true,
      state: state ?? null,
    },
    { status: 501 },
  )
}
