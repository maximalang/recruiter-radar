# TODO — Recruiter Radar Fix Plan

**Обновлено:** 2026-05-30
**Основание:** `/plan составь план исправления проблем`

---

## 📋 Проверка: Что уже сделано

| Задача | Статус |
|--------|--------|
| 4 stacked PRs созданы | ✅ (PRs #21, #22, #24, #25) |
| PR-23 (старый, wrong base) закрыт | ✅ |
| Remote branches использованы для PR heads | ✅ |

---

## 🎯 Текущий фокус: Исправления

### 🔴 P0: Критические (блокируют релиз)

#### 1.1: PR chain manual merge
- [ ] Merge PR-22 → main
- [ ] Merge PR-24 → main (автоматически получит base от PR-22)
- [ ] Merge PR-25 → main (автоматически получит base от PR-24)
- [ ] Merge `refresh-self-serve-mvp` → main (5 security commits)
- [ ] Merge `work/local-mvp` → main (6 commits, source adapters)

**Где:** GitHub UI — https://github.com/maximalang/recruiter-radar/pulls

---

#### 1.2: leadId → digestCandidateId rename (Launch Blocker #1)
- [ ] Переименовать `leadId` → `digestCandidateId` в `apps/web/app/onboarding/pilot/[orderId]/actions.ts`
- [ ] Переименовать в `apps/web/lib/digestFeedback.ts`
- [ ] Переименовать в `apps/web/app/api/digest/feedback/route.ts`
- [ ] Переименовать в `apps/web/app/api/digest/delivery/route.ts`
- [ ] Переименовать в `apps/web/app/digest/page.tsx`
- [ ] Переименовать в `apps/web/app/digest/[digestCandidateId]/page.tsx`
- [ ] Переименовать в `apps/web/app/api/digest/delivery/actions.ts`
- [ ] Запустить `grep -rn "leadId" apps/web/` — должен вернуть 0
- [ ] Запустить `npm run web:check`

**Из docs/self-serve-mvp.md:**
> "Legacy naming (`leadId` in actions/UI) still exists in web layer and should be renamed to `digestCandidateId` for full consistency."

---

### 🟡 P1: Документация и навигация

#### 2.1: Stale docs cleanup
- [ ] Удалить `docs/инфо о проекте.md` (494 строки, stale)
- [ ] Удалить `docs/инфоclaude.md` (1163 строки, stale)
- [ ] Обновить `tasks/todo.md` (этот файл)
- [ ] Проверить `memory/slash-commands-translations.md`
- [ ] Проверить `memory/enterprise-readiness-comprehensive-plan.md`

---

#### 2.2: Source adapters audit
- [ ] Проаудить HH adapter в `packages/db/scripts/work/local-mvp/`
- [ ] Проаудить EGRUL, Greenhouse, Lever adapters
- [ ] Проаудить career pages adapter
- [ ] Проаудить company sites adapter
- [ ] Проаудить funding adapter
- [ ] Проаудить tech job boards adapter
- [ ] Проаудить Rabota Rossii adapter
- [ ] Проверить entity resolution confidence logic
- [ ] Проверить evidence tier classification
- [ ] Создать audit report с production blockers

---

### 🟢 P2: Cleanup

#### 3.1: Stale branches cleanup
- [ ] Список remote branches: `git branch -r --list 'codex/*'`
- [ ] Удалить все `codex/*` remote branches
- [ ] Проверить `git branch -r --list 'codex/*'` = пусто

---

## 📊 Progress Tracker

| Phase | Задача | Статус | Примечание |
|-------|--------|--------|------------|
| P0 | PR chain merge | 🔴 Pending | Ручной GitHub merge |
| P0 | leadId rename | 🔴 Pending | Web layer files |
| P1 | Stale docs delete | 🟡 Pending | 2 docs + memory check |
| P1 | Source adapters audit | 🟡 Pending | 72 scripts, нужно чеклист |
| P2 | Stale branches | 🟢 Pending | ~20 codex/* branches |

---

## 📝 Reference

**PR Chain (из memory/pr-split-progress.md):**
- PR-21: `chore/crawler-typecheck-fix` → main — ✅ MERGED
- PR-22: `chore/remove-stale-review-docs-v2` → main — ✅ COMPLETE
- PR-24: `feat/lead-discovery-infra` → PR-22 — ✅ COMPLETE
- PR-25: `feat/leads-api-routes` → PR-24 — ✅ COMPLETE

**Launch blockers (из docs/self-serve-mvp.md):**
1. Entitlement gate must be mandatory (⚠️ проверить)
2. `leadId` → `digestCandidateId` rename (в этом todo)
3. Legacy schema deprecation plan (⚠️ нужен explicit plan)

**Merge sequence:**
```
gh pr merge #22 → gh pr merge #24 → gh pr merge #25 → main
gh pr merge refresh-self-serve-mvp → main
gh pr merge work/local-mvp → main
```