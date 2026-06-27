# Session Spec — Recruiter Radar: завершение клиентского продукта

> **Дата:** 2026-06-27. **Статус:** на утверждение.
> **Скоуп:** профиль/фильтры UX + matching-wiring, premium Telegram single-lead, стратегия путей доставки для РФ, дизайн интеграции AI.
> **НЕ затирает** корневой `SPEC.md` (v4.0, single source of truth) — это session-scoped план.
> **Дизайн (подтверждено):** существующая система — CSS Modules + текущие токены + Inter + gateBadge A/B/C/D + light-only. Расширяем `/leads` и internal-примитивы. **Без** Tailwind / второй дизайн-системы.

---

## 1. Цель и пользователь

Завершить клиентскую часть evidence-first радара лидов для российских рекрутинговых агентств:

1. **Профиль** = ответ на «**кто ваши идеальные клиенты?**», а не сырая форма БД; заполнение профиля **реально улучшает лиды** (поля действуют на фильтр/сортировку дайджеста, а не только на FIUR-скор при генерации).
2. **Доставка лида (Telegram)** — премиально, компактно, читается с телефона, сразу actionable, evidence-first.
3. **Практическая стратегия путей доставки** под РФ-рынок с рекомендацией «сейчас / следующее / позже».
4. **Поэтапный план интеграции AI**, не ослабляющий evidence-first; точки интеграции и UX-хуки подготовлены где дёшево.

**Пользователь:** владелец/ресёрчер агентства (1–30 чел.) в РФ. По каждому лиду за минуты: кто компания, что изменилось, почему сейчас, почему подходит, доказательства, безопасный контакт, следующий шаг.

**Не цель:** тяжёлый AI; новый дизайн-фреймворк; multi-lead digest в Telegram (backlog); полный CRM/webhook.

---

## 2. Аудит (база для плана)

### 2.A. Поля профиля vs matching-логика

`ClientProfile` (`apps/web/lib/clientProfiles.ts:28`). Три слоя матчинга:
- **FIUR `computeFit`** (`scoring/fiur.ts:267`) — скоринг при **генерации** (`total_score`).
- **`matchesClientProfile`** (`digest.ts:438`) — per-client **фильтр** дайджеста (вызовы `digest.ts:126,243`).
- **`getClientScopeScore`/`compareDigestItemsForClient`** (`digest.ts:486,471`) — per-client **сортировка**.

| Поле | FIUR computeFit | matchesClientProfile | сортировка |
|---|:--:|:--:|:--:|
| `industries` | ✅ | ✅ | ❌ |
| `includeKeywords` | ✅ | ✅ | ❌ |
| `excludeKeywords` | ❌ | ✅ | ❌ |
| `specialization` | ✅ | ❌ | ✅ |
| `targetCity` | ✅ (locations) | ❌ | ✅ |
| `roles` | ✅ (доля вакансий) | ❌ | ❌ |
| `companySizes` | ✅ | ❌ | ❌ |
| `excludedIndustries` | ✅ (`findExclusion`) | ❌ | ❌ |
| `contactPolicy` | reachability (отдельно) | ❌ | ❌ |
| `excludedLocations` | ❌ | ❌ | ❌ |
| `remoteFriendly` | ❌ | ❌ | ❌ |

### 2.B. Gaps

1. **Digest-фильтр рассинхронизирован с FIUR.** `roles`/`companySizes`/`excludedIndustries` влияют на score при генерации, но per-client фильтр их игнорирует.
2. **Три почти-мёртвых поля:** `contactPolicy`, `excludedLocations`, `remoteFriendly` не действуют как gate нигде в доставке. `contactPolicy=corporate_only` не отсекает лиды без корпоративной поверхности.
3. **Нет страницы профиля/настроек** — правится только в онбординг-форме (`onboarding/pilot/[orderId]`, `confirmPilotProfileAction`).
4. **Нет разделения** постоянные предпочтения vs временные фильтры разбора — `/leads/leads-filters.tsx` имеет только gate/feedback/practice.
5. **UX технический** — нет helper-text «почему улучшает лиды».

### 2.C. Telegram-доставка

- `formatTelegramLeadMessage` (`telegram.ts:63`) — плоский дамп `Компания/Статус/Score/Last signal at/Пользователь`, без `parse_mode`, английский лейбл.
- `sendLeadToTelegram` (`db.ts:125`) имеет `dc.payload` (evidence/opener/reasons/why-now), но шлёт пустышки.
- Богатая структура уже есть в `/leads/[id]/page.tsx` (Почему сейчас / Угол / Безопасный контакт / Доказательства / gate / opener / sources). Источник — `getLeadDetail` (`leads-data.ts:523`). Telegram должен её зеркалить.

---

## 3. План реализации (по приоритету)

### S1 — Профиль + фильтры
- `digest.ts`: расширить `matchesClientProfile` — `contactPolicy` gate (corporate_only → требовать корпоративную поверхность), `excludedLocations` → drop, `roles` → drop без пересечения (с учётом `remoteFriendly`). Расширить сортировку — boost по `roles`/`companySizes`.
- Премиальный UX профиля: группировка (Индустрии / Роли / Размер / Регионы+remote / Политика контакта / include-exclude / Исключения), helper-text, defaults. Переиспользовать `page-primitives.tsx`, `internal-page.tsx`. Словари из `clientProfiles.ts`.
- Сохранить контракт `ClientProfile`; менять labels/grouping/layout/helper-text/defaults + wiring.

### S2 — Premium Telegram single-lead
- `telegram.ts`: новый `formatTelegramLeadMessage` (HTML, `parse_mode:"HTML"`) — why-now, role/signal, gate-разделение A/B «готов писать» vs C «на проверку», sources, corporate surface, suggested action, опц. «почему подходит». HTML-escape строк.
- `db.ts` `sendLeadToTelegram`: распарсить `dc.payload` / `getLeadDetail`, передать реальные данные.

### S3 — Один путь доставки (подготовка)
- По матрице (§5): вероятно CSV/Excel-экспорт или CRM-ready status actions. UX-хук на `/leads`, без тяжёлого бэкенда.

### S4 — AI roadmap
- Документ + UX-хуки-плейсхолдеры в комментариях. Без модели.

**Не трогаем:** org identity/`WHERE source=$1`; confidence-gate логику; billing; FIUR additive-контракт; secrets; схему payload.

---

## 4. Команды и стиль

- `npm run web:check` после изменений (jest из `apps/web` cwd).
- `web:build` — только при изменении routes/middleware/next.config или когда patch commit-ready.
- TS строго, малые функции, без новых deps, русский copy премиальный без ложных обещаний.
- CodeGraph — primary search.

---

## 5. Deliverables (`/review` A–E)

A. profile/filter UX changes
B. новая структура lead-сообщения
C. ранжированная delivery-path матрица для РФ (Telegram bot/channel, email, in-app, push, CSV/Excel, webhook/CRM, Sheets/Notion, WhatsApp/VK)
D. AI integration roadmap (Stage 1 assist → Stage 2 enrichment → Stage 3 action; где в UI, что читает, на что влияет, что не переопределяет)
E. реализовано сейчас vs next-step

Pre-merge gate (CLAUDE.md): `/review` 5 осей; `codegraph_impact` на изменённые экспорты; signature-diff; doubt-driven для FIUR/Telegram.

---

## 6. Acceptance Criteria

1. `matchesClientProfile` учитывает `contactPolicy`/`excludedLocations`/`roles` — с тестами.
2. Профиль = «кто ваши идеальные клиенты?» с группировкой/helper-text; редактируется после активации.
3. Telegram single-lead — премиальная HTML-карточка с реальными данными из payload; HTML-escape; читается на мобильном.
4. `web:check` зелёный; jest зелёный; ни один путь доставки не сломан.
5. §5 A–E задокументированы.

---

## 7. Boundaries

- **Always:** web:check; HTML-escape в Telegram; контракт `ClientProfile`; переиспользовать примитивы; honest-репорт.
- **Ask first:** org identity/dedupe, billing, confidence-gate, миграции, схема payload, смена сигнатур экспортов.
- **Never:** Tailwind/2-я дизайн-система; секреты; чтение `.env*`/`node_modules`/`.next`; multi-lead digest (backlog); ослабление evidence-first ради AI.
