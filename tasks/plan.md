# План: Lead Generation Platform для Рекрутинговых Агентств

**Версия:** 4.0  
**Дата:** 2026-06-05  
**Статус:** Концепция из `docs/инфо о проекте.md` → конкретные задачи  
**Фокус:** Доведение продукта до «можно рекламировать» по концепции

---

## 🎯 Продуктовый контракт (из docs/инфо о проекте.md)

> **Радар компаний, которым стоит написать сегодня.**  
> Запускается за несколько минут, приносит короткий ежедневный список компаний с живым hiring-proof, объяснением почему сейчас и готовым углом первого контакта.

Бизнес-модель: **Self-serve на входе → paid pilot → assisted radar → premium desk**

Дифференциация: **Russia-first agency client radar** — локальные источники, российский compliance-by-design, работа по corporate contact paths и premium evidence bundles.

---

## 📊 Что уже реализовано (ядро)

| Зона | Статус | Что есть |
|---|---|---|
| FIUR scoring | ✅ Готово | Fit + Intent + Urgency + Reachability ∈ [0,4], все компонентные scorer'ы |
| Confidence gates | ✅ Готово | A/B/C/D с selectConfidenceGate + isDigestEligibleGate |
| Source stack P1 | ✅ Готово | HH, Rabota Rossii, ЕГРЮЛ/ФНС, Fedresurs, career pages |
| Source stack P2 | ✅ Готово | SuperJob, Habr Career |
| Telegram feedback | ✅ Готово | Беру / Мимо / Позже / Скрыть, HMAC-signed callbacks |
| Self-serve onboarding | ✅ Готово | Pilot activation, profile form, Telegram connect |
| Billing | ✅ Готово | Stripe integration, checkout flow |
| Entity resolution | ✅ Готово | SHA-256 + INN-based, Cyrillic normalization |
| Evidence bundles | ✅ Готово | EvidenceTier (direct/corroboration/context), EvidenceItemRecord |
| Contact paths | ✅ Готово | ContactCategory (8 типов), ContactQuality scorer |

---

## 📋 Задачи по концепции

### Задача 1: Цены и позиционирование
**Приоритет:** P0 — стоп-фактор для рекламы  
**Концепция:** «убрать 0 ₽ из публичных планов и заменить на реальную trial/pilot-math»

| Шаг | Что | Файл | Критерий |
|---|---|---|---|
| 1.1 | Обновить PUBLIC_PLANS — pilot 49 000 ₽, monthly 149 000 ₽/мес | `lib/publicProduct.ts` | Цена ≠ 0 ₽ и ≠ 1 ₽ |
| 1.2 | Обновить описания — premium Russian copy | `lib/publicProduct.ts` | Описание по концепции |
| 1.3 | Обновить hero-formula на landing | `app/page.tsx` | «компании, которым стоит написать сегодня» |
| 1.4 | Проверить checkout flow с новыми ценами | E2E | Pilot checkout проходит |

### Задача 2: Evidence-first lead card
**Приоритет:** P1 — ядро доверия  
**Концепция:** «каждый лид отвечает: кто компания, что изменилось, почему сейчас, почему подходит, какие доказательства, безопасный путь контакта, следующее действие»

| Шаг | Что | Файл | Критерий |
|---|---|---|---|
| 2.1 | Добавить `why_now` в LeadItem и digest | `lib/leads-data.ts`, `lib/hhDigest.ts` | Отдельное поле 1–2 аргумента |
| 2.2 | Добавить `best_angle` — угол контакта | `lib/leads-data.ts`, scoring | Отличается от opener |
| 2.3 | Добавить `lawful_contact_path` | `lib/leads-data.ts` | corporate form / generic HR / switchboard |
| 2.4 | Добавить `negative_signals[]` | `lib/leads-data.ts`, scoring | why not / risk factors |
| 2.5 | Добавить ИНН/ОГРН, domain, career_page_url | `lib/leads-data.ts`, SQL query | Из orgs + egrul |
| 2.6 | Обновить lead detail page | `app/leads/[id]/page.tsx` | Все новые поля видны |

### Задача 3: Human-in-the-loop review queue
**Приоритет:** P1 — качество выдачи  
**Концепция:** «машина делает 95% pipeline, человек проверяет 5% самых рискованных hot leads»

| Шаг | Что | Файл | Критерий |
|---|---|---|---|
| 3.1 | Добавить `review_status` enum | миграция | pending/approved/rejected |
| 3.2 | API route `/api/review` | `app/api/review/` | list pending, approve, reject |
| 3.3 | Review UI | `app/review/page.tsx` | Список + approve/reject |
| 3.4 | Auto-flag: score ≥ 80 + gate < A | `lib/scoring/` | pending_review автоматически |
| 3.5 | Human override rules | scoring pipeline | Все 5 правил из концепции |

### Задача 4: Negative signals & recruiter hiring penalty
**Приоритет:** P1 — точность модели  
**Концепция:** «вакансия рекрутера усиливает кейс только тогда, когда одновременно виден сложный или широкофункциональный external hiring-burst»

| Шаг | Что | Файл | Критерий |
|---|---|---|---|
| 4.1 | `detectAgencyReposts()` | `lib/lead-discovery/hiring-pattern-detector.ts` | Выявлять повторные посты |
| 4.2 | Stale role penalty | `lib/scoring/fiur.ts` | Повторяющиеся роли > 30 дней → штраф |
| 4.3 | `negative_signals[]` генерация | scoring pipeline | 3+ типа негативных сигналов |
| 4.4 | Negative signals в UI | lead detail | Видны risk factors |

### Задача 5: Lawful contact path — corporate-only default
**Приоритет:** P1 — compliance  
**Концепция:** «по умолчанию работать с company-level data и corporate contact paths»

| Шаг | Что | Файл | Критерий |
|---|---|---|---|
| 5.1 | `contact_policy` в client_profiles | миграция | corporate_only / no_personal / unrestricted |
| 5.2 | Фильтрация ContactPath по policy | scoring | Personal контакты отфильтрованы |
| 5.3 | UI: выбор contact policy | onboarding form | По умолчанию corporate_only |

### Задача 6: Landing & live preview
**Приоритет:** P1 — конверсия  
**Концепция:** «видимый результат за 3 минуты»

| Шаг | Что | Файл | Критерий |
|---|---|---|---|
| 6.1 | Hero copy update | `app/page.tsx` | «компании, которым стоит написать сегодня» |
| 6.2 | Preview карточки с gate/why_now/angle | `app/page.tsx` | Confidence visible |
| 6.3 | Preview → pilot conversion flow | E2E | End-to-end работает |

---

## 🏗 Порядок выполнения

```
Задача 1 (цены/позиционирование) → Задача 6 (landing)  [P0, один день]
Задача 2 (lead card)              → Задача 4 (negative)  [P1, 3–4 дня]
Задача 3 (review queue)                                  [P1, 2–3 дня]
Задача 5 (contact policy)                                [P1, 1 день]
```

---

## 🎯 Milestones

| Milestone | Критерий | Срок |
|---|---|---|
| M1: Product-market fit | Цены реалистичные, landing рассказывает правильную историю | +1 день |
| M2: Evidence-first | Каждый лид отвечает кто/почему сейчас/доказательства/путь контакта/рисков | +5 дней |
| M3: Quality loop | Review queue + negative signals + contact policy | +8 дней |
| M4: Ready to advertise | Landing → pilot конверсия работает, качество лидов проверяемо | +10 дней |
