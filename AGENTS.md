# AGENTS.md — Recruiter Radar (root)

Этот файл задаёт обязательные правила для Codex-агентов в репозитории `maximalang/recruiter-radar`.

## 1) Codex / GitHub workflow

- `main` — защищённая ветка. Нельзя открывать промежуточные PR в `main`, нельзя делать прямой push в `main`.
- `refresh-self-serve-mvp` — основная integration branch.
- Рабочие ветки задач: `codex/<task>` (например, `codex/add-agents-md`).
- Все промежуточные Codex PR должны быть **только** с base=`refresh-self-serve-mvp`.
- Нельзя заявлять, что PR создан или обновлён, без фактического URL, commit SHA и результатов required checks в отчёте.
- Единственный основной PR в `main`: `refresh-self-serve-mvp -> main`.
- Если существующий PR был обновлён вне Codex и не может быть безопасно продолжен в Codex, нужно:
  1. создать superseding PR в тот же base (`refresh-self-serve-mvp`),
  2. явно указать, какой PR он заменяет и почему.

## 2) Обязательный preflight перед каждой задачей

Перед изменениями и перед созданием PR обязательно выполнить и зафиксировать в отчёте:

1. текущая ветка: `git branch --show-current`
2. краткий статус: `git status --short`
3. remotes: `git remote -v`
4. проверка существующих open PR для соответствующих head/base
5. не создавать дубликат PR, если подходящий PR уже открыт

## 3) Required checks

Перед PR (и/или перед финальным отчётом) обязательно выполнить:

- `npm run web:check`
- `npm run web:build`

## 4) Definition of Done

Задача считается завершённой только если:

- внесён минимальный достаточный patch;
- required checks прошли успешно;
- в финальном отчёте указаны:
  - список changed files,
  - commit SHA,
  - результат проверок,
  - PR URL;
- если PR создать невозможно, нужно честно указать причину и приложить полный `git format-patch` для изменений.

## 5) Product rules (Recruiter Radar)

Recruiter Radar — это premium self-serve client-intelligence radar для рекрутинговых агентств РФ.

- Не ATS.
- Не CRM.
- Не candidate sourcing tool.
- Не mass outreach tool.

Ключевой flow продукта:

`Landing → live preview → pilot activation → client profile → Telegram connection → daily digest → feedback buttons → suppression/reweighting → better future digests`

Принципы:

- quality > quantity;
- каждая lead recommendation обязана отвечать на вопросы:
  - кто компания,
  - что изменилось,
  - почему сейчас,
  - почему подходит агентству,
  - evidence,
  - safe contact path,
  - next step;
- использовать FIUR: **Fit + Intent + Urgency + Reachability**;
- у каждого лида должны быть:
  - score breakdown,
  - confidence level,
  - evidence,
  - negative signals;
- Telegram callback buttons должны быть:
  - authenticated,
  - idempotent,
  - logged,
  - replay-safe,
  - и влиять на будущие digest;
- РФ/compliance по умолчанию:
  - company-level data by default,
  - no mass auto-outreach,
  - no unnecessary personal emails/phones.

## 6) n8n boundary

- `n8n` используется только для orchestration:
  - schedules,
  - retry,
  - webhook,
  - delivery,
  - alerts.
- Приложение (`Next.js + Postgres`) отвечает за:
  - scoring,
  - feedback,
  - billing,
  - entitlements,
  - suppression,
  - confidence gates.
- Нельзя переносить scoring/billing/suppression/feedback/confidence gates/entitlements в `n8n`.

## 7) Security

- Никогда не коммитить секреты, токены, `.env`, production chat IDs, `DATABASE_URL`, build artifacts (`.next`, `node_modules`, ZIP и т.д.).
- Использовать только env vars / credential stores.

## 8) AI usage boundary

AI не является источником истины. Допустимо использовать AI только как вспомогательный слой поверх evidence-driven данных, например для:

- summarization,
- classification,
- why_now,
- best_angle,
- draft opener.

Итоговые продуктовые решения и ранжирование должны опираться на проверяемые evidence.

## 9) Архитектурный принцип

- `Next.js + Postgres` = источник бизнес-логики.
- `n8n` = только orchestration.
