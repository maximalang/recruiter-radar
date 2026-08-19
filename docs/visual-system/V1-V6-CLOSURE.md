# Recruiter Radar V1–V6 visual closure

This document records the production visual invariants for the Calm Intelligence Workspace implementation.

## Product hierarchy

Primary information hierarchy:

**Signal → Why now → Evidence → Confidence → Action**

Authenticated product surfaces must remain scan-first, evidence-first and restrained. The landing may be more expressive, but must use the same semantic tokens and interaction language.

## Canonical visual system

- Semantic color, surface, separator, confidence, signal, radius and shadow tokens are the source of truth.
- `--c-*`, `--rr-*`, legacy landing aliases and component-local hardcoded colors/radii/shadows are prohibited.
- Versioned deploy metadata may exist for deployment verification, but must never be used as a visual selector.
- The global interaction layer is limited to generic cross-product safety. Component/page compatibility selectors are prohibited.

## Motion and interaction

- Motion durations and easing come from `product-motion-system.css`.
- Local timing/easing, `transition: all`, ambient infinite animation and decorative page-load choreography are prohibited.
- Infinite motion is reserved for a real pending/processing primitive.
- Hover styling must be capability-gated by hover media queries; focus-visible remains independent and keyboard-accessible.
- Standalone interactive controls target at least 44×44 CSS pixels.
- Reduced-motion mode must suppress non-essential motion.

## Surface grammar

- Product workspaces use hierarchy, rows, zones, ledgers and separators instead of card-everything layouts.
- Evidence Radar uses restrained evidence geometry rather than HUD/neon decoration.
- Situations use decision/evidence ledgers; retired opportunity cards and metric-bar grids are not part of the visual grammar.
- Public legal documents are documentary: no glossy blur, decorative gradients or elevated-card treatment.
- Dead compatibility and retired visual layers are deleted instead of hidden by global overrides.

## Responsive proof

The responsive audit covers the product route matrix at 12 viewports:

- 320×568
- 360×800
- 375×812
- 390×844
- 430×932
- 768×1024
- 1024×768
- 1280×800
- 1366×768
- 1440×900
- 1536×960
- 1920×1080

The audit checks horizontal overflow, clipped controls, 44px interaction targets, accessible names, form button types, invalid links, duplicate IDs, dialogs, reduced motion, continuous animation, disclosure behavior, keyboard focus, visible focus indication and browser console/page errors.

Green runs persist representative screenshots for Landing, Login, Checkout and Legal at mobile, tablet and desktop sizes. Authenticated E2E/accessibility evidence covers the core decision workflow and settings/security surfaces.

## Frozen product semantics

Visual closure does not change scoring formulas, evidence qualification, opportunity state-machine rules, entitlement decisions, billing outcomes, source scheduling, ingestion semantics or migration semantics.

## Merge rule

Treat V1–V6 as visually closed only when the exact PR head passes the semantic visual contract and the full PR CI/runtime/browser matrix. Do not infer closure from an older green SHA.
