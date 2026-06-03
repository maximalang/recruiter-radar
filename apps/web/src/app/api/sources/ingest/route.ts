import { NextRequest, NextResponse } from 'next/server'
import {
  ingestSource,
  ingestAllPrimarySources,
  type SourceId,
  type IngestResult,
} from '@/lib/lead-discovery/source-ingest'

// Force Node.js runtime — ingestion requires child_process (no Edge/serverless)
export const runtime = 'nodejs'

const VALID_SOURCES: Set<SourceId> = new Set(['hh', 'superjob', 'habr-career', 'career-pages', 'egrul-fns'])

/**
 * Runtime guard: ingestion uses child_process.execFile which requires
 * Node.js runtime. This route will not work in Edge/serverless runtimes
 * that lack file system and process spawning.
 */
const RUNTIME_OK = typeof process !== 'undefined' && typeof process.env !== 'undefined'

export async function POST(request: NextRequest) {
  // Runtime guard
  if (!RUNTIME_OK) {
    return NextResponse.json(
      { success: false, error: 'Ingestion requires Node.js runtime (not Edge/serverless).' },
      { status: 501 }
    )
  }

  // Auth check — INGEST_API_KEY with fallback to LEAD_API_KEY and DIGEST_API_KEY
  const apiKey = process.env.INGEST_API_KEY || process.env.LEAD_API_KEY || process.env.DIGEST_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'INGEST_API_KEY is not configured.' },
      { status: 500 }
    )
  }
  const authHeader = request.headers.get('x-api-key')
  if (authHeader !== apiKey) {
    return NextResponse.json(
      { success: false, error: 'Invalid or missing x-api-key header.' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()
    const { source, sources, env: extraEnv } = body as {
      source?: SourceId
      sources?: SourceId[]
      env?: Record<string, string>
    }

    // Validate source IDs
    if (source && !VALID_SOURCES.has(source)) {
      return NextResponse.json(
        { success: false, error: `Invalid source: ${source}. Valid: ${Array.from(VALID_SOURCES).join(', ')}` },
        { status: 400 }
      )
    }
    if (sources) {
      const invalid = sources.filter(s => !VALID_SOURCES.has(s))
      if (invalid.length > 0) {
        return NextResponse.json(
          { success: false, error: `Invalid sources: ${invalid.join(', ')}. Valid: ${Array.from(VALID_SOURCES).join(', ')}` },
          { status: 400 }
        )
      }
    }

    let results: IngestResult[]

    if (source) {
      // Single source ingestion
      results = [await ingestSource(source, extraEnv)]
    } else if (sources && sources.length > 0) {
      // Multiple sources in sequence
      results = []
      for (const s of sources) {
        results.push(await ingestSource(s, extraEnv))
      }
    } else {
      // Default: ingest all primary sources
      results = await ingestAllPrimarySources(extraEnv)
    }

    const allSuccess = results.every(r => r.success)
    const summary = {
      total: results.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      fetchedTotal: results.reduce((sum, r) => sum + (r.fetchedCount ?? 0), 0),
      upsertedTotal: results.reduce((sum, r) => sum + (r.upsertedCount ?? 0), 0),
    }

    return NextResponse.json({
      success: allSuccess,
      data: { results, summary },
    }, { status: allSuccess ? 200 : 207 }) // 207 Multi-Status for partial failures
  } catch (error) {
    console.error('Source ingestion error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to ingest sources' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'POST to trigger source ingestion',
    endpoints: {
      '/api/sources/ingest': {
        method: 'POST',
        description: 'Trigger data ingestion for lead sources',
        parameters: {
          source: 'Single source ID to ingest (optional)',
          sources: 'Array of source IDs to ingest in sequence (optional)',
          env: 'Extra environment variables for the ingestion script (optional)',
        },
        availableSources: [
          {
            id: 'hh',
            name: 'HeadHunter',
            requires: 'HH_USER_AGENT',
            description: 'Primary Russian job board — fetch vacancies and upsert signals',
          },
          {
            id: 'superjob',
            name: 'SuperJob',
            requires: 'SUPERJOB_API_KEY',
            description: 'Secondary Russian job board',
          },
          {
            id: 'habr-career',
            name: 'Habr Career',
            requires: 'None',
            description: 'IT-focused job board',
          },
          {
            id: 'career-pages',
            name: 'Career Pages',
            requires: 'None',
            description: 'Company career page crawl and enrichment',
          },
          {
            id: 'egrul-fns',
            name: 'EGRUL/FNS Registry',
            requires: 'None',
            description: 'Russian company registry data',
          },
        ],
        default: 'If no source/sources specified, ingests all primary sources (hh, superjob, habr-career)',
      },
    },
  })
}
