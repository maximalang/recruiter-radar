# Source Refresh Clock — ежедневный durable evidence-capture (t_e64a6b6e)

Инструментировка протокола v2 (§9, §16): каждый UTC-день окно Source Refresh Clock
фиксируется в Postgres как append-only снапшот + per-run archive index + derived
alerts. Это создаёт датированные daily-снапшоты, из которых задача t_c815a6ea
(7-consecutive-day live window) берёт доказательство без ручного обхода артефактов.

## Пайплайн (CI: source-refresh-evidence-capture.yml, 00:35 UTC daily)

1. `gh run download` тик-артефактов дня: одна директория на run, имя = run_id.
2. `scripts/collect-refresh-logs.mjs` — summaries `<run_id>.json`, authority-bound.
3. `scripts/build-coverage-snapshot.mjs` — дневной снапшот `<day>.json` или
   `<day>.pending.json` (PENDING_CLOSE draft), fail-closed.
4. `scripts/capture-source-refresh-evidence.mjs` — persist в Postgres:
   - re-hash snapshot (`recomputeSnapshotHash`) и сверка с `snapshot_hash`;
   - tamper/chain verification по сохранённым дням;
   - sweep отсутствующих предыдущих дней → алерты `missing_snapshot`;
   - fail-closed exit-коды: 2 env, 3 snapshot-артефакт, 4 DB, 5 integrity,
     6 alerts, 7 tamper/chain;
   - идемпотентно: повторный capture того же дня — no-op/upgrade, не дубль.

## Хранение

- `source_refresh_evidence_snapshots` — 1 строка на UTC-день, PK evidence_day_utc;
  `snapshot_published` (immutable `.json`) vs unpublished (`.pending.json` draft,
  заменяется опубликованной версией дня — upgrade, не tamper); hash-цепочка
  `predecessor_snapshot_hash`; `captured_by_run_url` — identity capture-рана.
- `source_refresh_evidence_log_archive` — per-run digests (`computeArtifactDigest`
  тулчейна), byte counts, storage_key; строки append-only upsert.
- `source_refresh_evidence_alerts` — derived (red_day, missing/late_snapshot,
  tick_ledger_defect, tamper_detected, hash_chain_broken, provenance_unverified);
  dedupe (alert_type, dedupe_key); resolve c причиной, без затирания истории.

## Миграция

`packages/db/migrations/20260829090000_add_source_refresh_evidence_capture.sql`
(down рядом). Применение: `npm run db:migrate` (стандартный migrator).

## Секрет

`RR_EVIDENCE_DATABASE_URL` — отдельный Postgres credentials для capture-воркфлоу
(только эти три таблицы; минимальные права). Вводится как repo secret.

## Локальные проверки

```bash
node --test scripts/source-refresh-clock-regression.test.mjs   # протокол, 16/16
node --test scripts/test-source-refresh-evidence-store.mjs     # store unit, 17/17
npm run test:source-refresh-evidence:db                        # DB roundtrip D1–D7,
                                                               # требует SOURCE_LIVE_DB_TEST_ACK=isolated
                                                               # + disposable DATABASE_URL
```

## Границы

- Захват не «озеленяет» день: RED/missing дни сохраняются как есть и алертятся.
- Структурно-зелёные локальные прогоны не считаются живым окном (t_c815a6ea).
- Ретеншн артефактов capture-рана 90 дней; БД — durable слой аудита.
