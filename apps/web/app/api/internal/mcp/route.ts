import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

function disabled() {
  return NextResponse.json({ error: 'not_found' }, { status: 404, headers: HEADERS })
}

export async function GET(_request?: Request) {
  return disabled()
}

export async function POST(_request?: Request) {
  return disabled()
}

export async function DELETE(_request?: Request) {
  return disabled()
}

export async function OPTIONS(_request?: Request) {
  return disabled()
}
