# rr-ux

Review UX and conversion aspects of current changes. Use when modifying user-facing interfaces or activation flows.

## Usage

`/rr-ux`

## What it reviews

### 1. Activation Flow

Does the change support the core product loop?
```
Landing → live preview → pilot activation → client profile → Telegram connection →
daily digest → feedback buttons → suppression/reweighting → better future digests
```

### 2. Quality Signals

Does the UI reinforce quality over quantity?
- Evidence is visible and actionable
- Confidence levels are displayed clearly
- "Why now" is explained

### 3. Russian Copy

Is the language concise, premium, and specific?
- Avoid: "гарантированные клиенты", "100% результат", "автоматически закрываем продажи"
- Prefer: "компании, которым стоит написать сегодня", "сигналы найма", "доказательства", "почему сейчас"

### 4. Telegram Digest Elements

For digest-related changes:
- Company name present
- Score and confidence displayed
- "Why now" explanation
- Best angle
- Safe next action
- All 8 feedback buttons present

### 5. Accessibility

- Keyboard navigation works
- Screen reader conveys content
- Error states have meaningful messages
- Loading states use skeletons (not spinners for content)
- Empty states have guidance

### 6. No AI Aesthetic

Avoid:
- Purple/indigo everywhere
- Excessive gradients
- Rounded everything (rounded-2xl)
- Generic hero sections
- Lorem ipsum-style copy
- Oversized padding everywhere
- Stock card grids
- Shadow-heavy design

## Output format

```
=== UX REVIEW ===

ACTIVATION FLOW:
- [pass|fail|partial] <comment>
- <issue if any>

QUALITY SIGNALS:
- [pass|fail|partial] <comment>
- <issue if any>

RUSSIAN COPY:
- [pass|fail|partial] <comment>
- <issue if any>

TELEGRAM DIGEST:
- [pass|fail|n/a] <comment>
- <issue if any>

ACCESSIBILITY:
- [pass|fail|partial] <comment>
- <issue if any>

AI AESTHETIC:
- [pass|fail|partial] <comment>
- <issue if any>

OVERALL: <pass|needs-work>
```

## When to run

- When building or modifying UI components
- When reviewing activation flows
- Before completing UX-focused tasks
- When the user asks to review "look and feel"

## Skills to use

- `frontend-ui-engineering` — for detailed UI patterns and accessibility
- `using-agent-skills` — if unclear which skill applies