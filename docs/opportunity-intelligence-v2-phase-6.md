# Opportunity Intelligence v2 — Phase 6: Evidence-bound Sales Strategist v1

## Граница фазы

Sales Strategist v1 — детерминированный rule-based слой поверх существующих
Hiring Episode, scoring и Agency DNA. Он не создаёт второй Opportunity writer и
не меняет FIUR, score, hard gates, action eligibility, контактные пути или
Outcome Ledger. LLM в Phase 6 не вызывается. Будущий LLM может редактировать
формулировки только после построения фактов и выводов и не может добавлять
факты, менять score/gates, выбирать контакт или отправлять сообщение.

Версии первой реализации:

- strategist contract: `opportunity-strategist-v1`;
- opportunity brief builder при включённой фазе: `opportunity-brief-v3`;
- прежний выключенный путь: `opportunity-brief-v2`.

Изменение версии builder входит в semantic input hash. Поэтому первое включение
или отключение Strategist приводит к воспроизводимому rebuild, а неизменившийся
input остаётся идемпотентным.

## Контракт карточки

Карточка содержит:

- `whatChanged`;
- `whyNow`;
- `problemHypothesis`;
- `agencyFitExplanation`;
- `externalSupportNeedExplanation`;
- `recommendedPersona`;
- `recommendedAngle`;
- `recommendedCaseStudy`;
- `recommendedNextAction`;
- `riskSignals`;
- `limitations`;
- полный `evidenceTimeline` в публичной проекции.

Каждый вывод имеет `basis=evidence` и непустые `supportingEvidenceIds` либо
`basis=heuristic` и пустой список evidence IDs. Persisted JSON читается только
через строгий versioned parser. Неполный, неизвестной версии, слишком длинный,
содержащий email/телефон или некорректную evidence lineage объект не попадает в
repository/API/UI.

Допустимые persona — только функции: Head of Recruitment, HRD, CTO или
руководитель коммерческого направления. Конкретный человек не определяется.
Формулировки не утверждают наличие бюджета, готовность работать с агентством,
конкретного ЛПР, провал внутреннего рекрутинга, вероятность сделки или
гарантированный результат.

## Case matching

Кейс можно рекомендовать только при одновременном структурном совпадении по
всем пяти измерениям:

1. role family;
2. industry;
3. company size;
4. region;
5. hiring mode.

Описание кейса должно быть `publicSafeDescription` без email/телефона. Если
хотя бы одно измерение неизвестно или не совпало, карточка явно сообщает, что
структурно подтверждённого кейса нет. Старые кейсы без `hiringModes` безопасно
не совпадают.

## Флаги и rollback

```text
OPPORTUNITY_STRATEGIST_V1_ENABLED=false
OPPORTUNITY_STRATEGIST_V1_CANARY_WORKSPACE_IDS=
```

Strategist требует включённый Agency DNA v1 в том же workspace. Глобальный флаг
принимает только точное `true`. Canary принимает ровно один положительный
workspace ID; список, wildcard, дубликат, ведущий ноль и несовпадение с Agency
DNA отклоняются.

Read и write paths проверяют один и тот же workspace context. При очистке
Strategist-флага или canary уже сохранённая карточка сразу скрывается из
repository/API/UI; следующий обычный build возвращает metadata и builder
version на legacy v2 path. Удалять историю или менять схему для rollback не
нужно.

## Canary-порядок и stop conditions

До отдельного явного разрешения оба флага остаются выключенными. Для будущего
canary нужен существующий workspace с валидной versioned Agency DNA, реальными
hiring evidence и разрешённым Opportunity engine. После включения одного
workspace следует проверить rebuild, публичный API и ручную пригодность карточки
для качественного черновика обращения.

Canary немедленно выключается и не расширяется, если:

- tenant/workspace/profile context расходится;
- legacy workspace изменился при выключенном флаге;
- evidence-вывод не имеет допустимых evidence IDs или ссылается не на episode;
- heuristic-вывод представлен как подтверждённый факт;
- карточка утверждает бюджет, agency readiness, конкретного ЛПР, провал
  внутреннего рекрутинга, вероятность сделки или гарантию результата;
- кейс рекомендован без совпадения всех пяти измерений;
- API возвращает raw metadata, hash, личный email или телефон;
- отключение флага не скрывает карточку немедленно;
- score, hard gates, action queue, Outcome Ledger или legacy brief path
  изменяются за пределами описанной versioned интеграции.

## Проверки

```powershell
npm.cmd run web:check
npm.cmd run test --workspace @recruiter-radar/web -- --runInBand `
  apps/web/src/__tests__/lib/opportunities/opportunity-strategist-v1.test.ts `
  apps/web/src/__tests__/lib/opportunities/jobs.test.ts `
  apps/web/src/__tests__/lib/opportunities/repository.test.ts `
  apps/web/src/__tests__/lib/opportunities/api-projection.test.ts `
  apps/web/src/__tests__/app/opportunities/opportunity-card.test.tsx
npm.cmd run web:build
```

Phase 6 не содержит миграции и не включает production/canary flags.
