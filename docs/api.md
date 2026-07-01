# Internal API — leads, profile, sources

Lightweight internal/product API over the same owner-scoped boundaries the web
UI uses. All lead/profile routes authenticate via the **signed session cookie**
(`rr_sid`, same boundary as `/leads` and `/settings/profile`). The sources route
is **admin-key gated** because it exposes operational telemetry, not tenant data.

Design rules honored by every route:

- **Owner-scoped everywhere.** Reads and writes filter by the session owner (or,
  for the admin route, require the ingest key). No cross-tenant leakage, no IDOR.
- **No leaky 401s on read.** Session-scoped GETs return `200` with an empty/inert
  shape when there is no session — they never confirm or deny existence with a
  status code.
- **Clean projections.** Responses deliberately omit raw internal fields
  (`structuredReasons`, `opener` draft, `sourceExternalId`, raw payload,
  candidate source keys, `suppressedUntil`).
- **Deterministic evidence vs. AI hint stay separated.** The AI layer is always
  returned under its own `aiEnrichment` / `hasAiHint` key, never merged into
  deterministic evidence.

All routes are `export const dynamic = 'force-dynamic'` (never cached).

---

## GET /api/leads

Owner-scoped, paginated lead list for the current session — the API mirror of the
`/leads` page.

**Auth:** signed session cookie. No session → `200` with an empty list.

**Query params:**

| Param      | Type   | Default | Notes                                                        |
|------------|--------|---------|--------------------------------------------------------------|
| `page`     | int    | `1`     | 1-based; clamped to `>= 1`.                                  |
| `pageSize` | int    | `25`    | Clamped to `[1, 100]`.                                        |
| `gate`     | string | —       | One of `A`/`B`/`C`/`D`; anything else ignored.               |
| `feedback` | string | —       | Must be a known feedback status; anything else ignored.      |
| `profile`  | string | —       | Narrows to one active profile **owned by the caller**; a foreign or unknown id is ignored and the read falls back to all active owned profiles. |

**Response `200`:**

```jsonc
{
  "leads": [
    {
      "id": "…",
      "orgName": "Ромашка",
      "score": 3.2,
      "signalStrength": "3.2",          // [0,4] scale, one decimal
      "scoreBand": { "label": "…", "tone": "…" },
      "confidenceGate": "A",
      "whyNow": "…" | null,
      "whyMatch": ["Регион: Москва", "…"],
      "topEvidence": ["Backend", "DevOps"], // up to 5 titles
      "vacanciesCount": 3,
      "locationNames": ["Москва"],
      "lawfulContactPath": "…" | null,
      "sourceFamilies": ["career-pages"],
      "latestPublishedAt": "…" | null,
      "feedbackStatus": "…" | null,       // null when 'none'
      "hasAiHint": true,                  // presence flag only, no AI text here
      "createdAt": "…"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 25
}
```

**Errors / degrade:** any data-layer failure degrades to a `200` empty page
(`{ leads: [], total: 0, page, pageSize }`) rather than a `500`, so a transient DB
issue never leaks a stack or blocks the UI.

---

## GET /api/leads/:id

Owner-scoped lead detail — the API mirror of the lead-detail page. Separates
deterministic decision drivers/evidence from the attributed AI layer.

**Auth:** signed session cookie. `getLeadDetail` is itself owner-scoped, so a lead
owned by another tenant (or no session) returns `null` → **`404`**. Existence is
never leaked across owners.

**Response `200`:**

```jsonc
{
  "id": "…",
  "orgName": "…",
  "score": 3.2,
  "signalStrength": "3.2",
  "scoreBand": { "label": "…", "tone": "…" },
  "confidenceGate": "A",

  // Deterministic decision drivers
  "whyNow": "…" | null,
  "bestAngle": "…" | null,
  "fit": [{ "dimension": "…", "text": "…" }],   // [] when no profile/empty
  "companySummary": {
    "identity": "…", "hiringMotion": "…",
    "agencyRelevance": "…", "strength": "…"
  },

  // Deterministic evidence
  "evidence": {
    "titles": ["…"],
    "vacanciesCount": 3,
    "distinctVacancyNamesCount": 2,
    "latestPublishedAt": "…" | null,
    "sourceFamilies": ["…"]
  },
  "negativeSignals": ["…"],

  // Reachability
  "lawfulContactPath": "…",
  "locationNames": ["…"],
  "orgDomain": "…" | null,
  "orgWebsite": "…" | null,
  "careerPageUrl": "…" | null,

  // Attributed, advisory AI layer — explicitly separated from evidence above
  "aiEnrichment": { … } | null,

  "feedbackStatus": "…" | null,
  "createdAt": "…"
}
```

**Errors:** `404 { "error": "not_found" }` — no session, unknown id, or a lead
owned by a different tenant (indistinguishable by design).

---

## GET /api/profile/preview

Approximate current match count for the owner's profile plus the completion
breakdown — powers the live "match-count preview" and completion panel.

**Auth:** signed session cookie. No session or no profile → `200` with
`hasProfile: false`.

The match count runs the **same gate path the digest uses**
(`countMatchingCandidatesForProfile`), so the number reflects exactly what the
filters would deliver.

**Response `200`:**

```jsonc
{
  "hasProfile": true,
  "matchCount": 42 | null,           // null if the count scan failed
  "completion": {
    "filledCount": 6,
    "totalCount": 8,
    "ratio": 0.75,
    "isComplete": false,
    "groups": [{ "key": "…", "label": "…", "filled": true }]
  }
}
```

When there is no session/profile: `{ "hasProfile": false, "matchCount": null, "completion": null }`.

---

## PATCH /api/profile/preferences

Update the owner's delivery preferences. **PATCH semantics:** every field is
optional; omitted fields keep their stored value (read-merge-write).

**Auth:** signed session cookie. No session → **`401`**. Writes are owner-scoped
inside `saveDeliveryPreferencesByOwnerId` (`UPDATE … WHERE owner_id = $1`), the
same anti-IDOR boundary as the settings action.

**Request body (JSON, all optional):**

```jsonc
{
  "webPushEnabled": true,          // boolean
  "emailDigestEnabled": false,     // boolean
  "digestEmail": "a@b.co" | null   // string or null
}
```

> Block 3 extends this same route additively with delivery-time fields
> (`deliveryEnabled`, `deliveryChannel`, `deliveryTimeLocal`, `deliveryTimezone`,
> `deliveryFrequency`).

**Response `200`:** `{ "ok": true, "preferences": { … } }`

**Errors:**

| Status | Body                                   | Cause                                   |
|--------|----------------------------------------|-----------------------------------------|
| `401`  | `{ "error": "unauthorized" }`          | No session.                             |
| `400`  | `{ "error": "invalid_json" }`          | Body is not valid JSON.                 |
| `400`  | `{ "error": "<field> must be …" }`     | A provided field has the wrong type.    |
| `404`  | `{ "error": "not_found" }`             | No existing preferences row for owner.  |

---

## GET /api/sources/status

Internal-admin source registry + last-24h health summary. Operational telemetry
only — exposes **no** lead or tenant data.

**Auth:** `INGEST_API_KEY` via the `x-api-key` header (same key/boundary as the
ingest route). This is admin-key gated rather than session-scoped.

**Response `200`:**

```jsonc
{
  "sources": [
    {
      "id": "career-pages",
      "name": "…",
      "category": "…",
      "isPrimary": true,
      "requiredEnvVars": ["…"],
      "health": {
        "status": "…",
        "overall": "…",
        "recordsLast24h": 50,
        "lastRun": "…" | null
      } | null
    }
  ],
  "summary": { "total": 12, "primary": 5 }
}
```

**Errors:**

| Status | Body                                          | Cause                               |
|--------|-----------------------------------------------|-------------------------------------|
| `500`  | `{ "error": "INGEST_API_KEY is not configured." }` | Server missing the admin key.  |
| `401`  | `{ "error": "Invalid or missing x-api-key header." }` | Wrong/absent `x-api-key`.   |

Health lookup degrades to `health: null` per source if the dashboard query fails;
it never fails the whole request.
