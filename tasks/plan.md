# План исправлений — Recruiter Radar

**Версия:** 1.0
**Дата:** 2026-05-30
**Статус:** В работе
**Основание:** `/plan составь план исправления проблем`

---

## 🔍 Что нужно исправить

Из self-serve-mvp.md и контекста проекта:

1. **PR chain manual merges** — цепочка 4 PR (1 мержнут, 3 готовы к мержу)
2. **leadId → digestCandidateId rename** — launch blocker (web layer)
3. **Stale docs cleanup** — устаревшие документы на 1600+ строк
4. **Source adapters audit** — 72 .mjs скрипта требуют ревью
5. **Stale branches cleanup** — ~20 `codex/*` remote branches

---

## 📊 Dependency Graph

```
PR chain merge (manual, блокирует все)
    ↓
leadId rename (web layer, launch blocker)
    ↓
Stale docs cleanup (не блокирует, но мешает навигации)
    ↓
Source adapters audit (следующий этап)
    ↓
Stale branches cleanup (ветки codex/*)
```

---

## 🏗️ Vertical Slices

### Slice 1: PR chain manual merge

**Цель:** Merged-состояние 4 PR в main

**Merge order:**
```
#22 (chore/remove-stale-review-docs-v2 → main) MERGE
    ↓
#24 (feat/lead-discovery-infra → #22) MERGE
    ↓
#25 (feat/leads-api-routes → #24) MERGE
    ↓
main
```

**Также:**
- `refresh-self-serve-mvp` → main (5 security commits)
- `work/local-mvp` → main (6 commits, source adapters)

**Verification:**
- All 4 PRs show "Merged" in GitHub UI
- `main` содержит все коммиты через chain

---

### Slice 2: leadId → digestCandidateId rename (Launch Blocker #1)

**Цель:** Убрать legacy naming в web layer

**Файлы (из grep leadId - web layer):**
- `apps/web/app/onboarding/pilot/[orderId]/actions.ts` — UI actions
- `apps/web/lib/digestFeedback.ts` — feedback lib
- `apps/web/app/api/digest/feedback/route.ts` — API route
- `apps/web/app/api/digest/delivery/route.ts` — delivery API route
- `apps/web/app/digest/page.tsx` — digest UI page
- `apps/web/app/digest/[digestCandidateId]/page.tsx` — detail page
- `apps/web/app/api/digest/delivery/actions.ts` — delivery actions

**Acceptance Criteria:**
- [ ] Все встречающиеся `leadId` в web layer переименованы в `digestCandidateId`
- [ ] Проверка `grep -r "leadId" apps/web/` возвращает пустой результат
- [ ] `npm run web:check` проходит
- [ ] Routing URLs используют `digestCandidateId` как параметр

**Verification Steps:**
1. `grep -rn "leadId" apps/web/` — должен вернуть 0 результатов
2. `npm run web:check` — должен пройти без ошибок
3. Проверить routes и navigation links

---

### Slice 3: Stale docs cleanup

**Цель:** Удалить или заменить устаревшую документацию

**Удалить:**
- `docs/инфо о проекте.md` (494 строки, stale с 2026-05-26)
- `docs/инфоclaude.md` (1163 строки, stale с 2026-05-26)

**Обновить/переписать:**
- `tasks/plan.md` — заменить старый Lead Generation Plan (2026-05-26) на текущий fix plan
- `tasks/todo.md` — заменить старый TODO (2026-05-26) на текущие задачи

**Также:**
- `memory/slash-commands-translations.md` — проверить актуальность
- `memory/enterprise-readiness-comprehensive-plan.md` — проверить актуальность

**Verification:**
- `docs/инфо о проекте.md` не существует
- `docs/инфоclaude.md` не существует
- `tasks/plan.md` содержит текущий fix plan
- `tasks/todo.md` содержит текущие задачи

---

### Slice 4: Source adapters production-readiness audit

**Цель:** Проверить все 72 .mjs source-скрипта на продакшен readiness

**Локации:**
- `packages/db/scripts/work/local-mvp/` — HH adapter, EGRUL, Greenhouse, Lever
- `packages/db/scripts/` — career pages, company sites, funding, tech boards, russian rabota

**Checklist per adapter:**
- [ ] Source name and family correctly defined
- [ ] Entity resolution confidence logic
- [ ] Evidence tier classification (hire_intent / enrich / context)
- [ ] Error handling (network, parse, validation)
- [ ] Rate limiting compliance
- [ ] Logging with structured output
- [ ] No hardcoded secrets
- [ ] TypeScript interfaces aligned

**Acceptance Criteria:**
- [ ] Audit report для каждого адаптера
- [ ] Confidence-gated evidence classification validated
- [ ] Production blockers identified and filed as issues

---

### Slice 5: Stale remote branches cleanup

**Цель:** Удалить ~20 устаревших `codex/*` remote branches

**Команда:**
```bash
git branch -r --list 'codex/*' | while read b; do
  echo "$b" | grep -v HEAD | cut -d/ -f2-
done | xargs -r git push origin --delete
```

**Acceptance Criteria:**
- [ ] `git branch -r --list 'codex/*'` возвращает пустой результат

---

## 🎯 Checkpoints

### CP1: PR chain merged
- All 3 remaining PRs merged to main
- `refresh-self-serve-mvp` merged
- `work/local-mvp` merged

### CP2: launch blockers resolved
- `leadId` rename complete
- `npm run web:check` passes

### CP3: Docs clean
- Stale docs deleted
- `tasks/plan.md` and `tasks/todo.md` up to date

### CP4: Source adapters audited
- Audit report written
- Production blockers identified

### CP5: Branches cleaned
- All codex/* remote branches deleted

---

## 🚀 Quick Wins

1. **Merge PRs** — просто GitHub UI, no code
2. **Delete stale docs** — 2 команды rm, убирает 1657 строк мусора
3. **leadId rename** — grep → edit → check

---

## Reference: PR Chain (из memory/pr-split-progress.md)

| # | Branch | Base | PR | Status |
|---|--------|------|-----|--------|
| 1 | `chore/crawler-typecheck-fix` | `main` | #21 | ✅ MERGED |
| 2 | `chore/remove-stale-review-docs-v2` | PR-1 | #22 | ✅ COMPLETE |
| 3 | `feat/lead-discovery-infra` | PR-2 | #24 | ✅ COMPLETE |
| 4 | `feat/leads-api-routes` | PR-3 | #25 | ✅ COMPLETE |

**Merge sequence:** #22 → #24 → #25 → main
