# Native story preview decision

Scope: `/story` is an additive, non-indexed owner preview. `/`, billing, checkout, data contracts and existing landing audit assertions are unchanged. All three story CTAs link to https://recruiter-radar.ru. Company confirms route/scene placement before integration; owner preview + independent QA precede merge/publish.

Eight scenes: hero → timing problem → accumulating signals → priority (native interactive demo) → manual contact → five fields → boundaries → closing. Hero illustration is present in SSR immediately; no JS is needed for public information or CTAs.

Source/copy authority: company SPEC `ventures/docs/rr/landing-own-20261008/SPEC.md`; BRIEF `tools/capabilities/scrollytelling/brief-rr-20261007/BRIEF.md`, BEGIN_PUBLIC_COPY (49 values). The original catalogue is unchanged. The schematic demo is explicitly disclosed and uses catalogue copy instead of source/company count claims.

Crossover lineage: native RR `afbd6db5`, `apps/web/app/landing/hero-product-preview.tsx` and `detection-scene.module.css` copied into the isolated `story/demo/` namespace, not vendor code. Four-stage navigation, sidebar, peek/hover/touch/pin, keyboard/Escape/focus, typing and manual-paused cadence are retained. Enhancement starts only when the demo is intersecting; visible static SSR fallback remains. Local tokens adapt its palette; no global palette override. Native implementation remains isolated until the owner approves placement; rollback is deletion of the additive route/files.

Read-only published-motion catalogue (2026-10-08): https://recruiter-radar.scrollytelling.ai/ has three `st-si-card` sticky image/text panels in the opening sequence, two `st-sp-img` pinned image split scenes, and five sticky field-card panels. Read at scroll offsets 0/1600/2200/3000/4200/5000/5600/6200; observed transforms were stationary in this published revision, while hero image retained scale 1.04. No vendor code/assets were copied; original SVG artwork is used. Native card entrances, artwork assembly and text reveals preserve these narrative clusters while removing long pinned holds and unreadable stacking. Intentional adaptation: bounded one-shot choreography, not a literal overlapping sticky stack; no essential text ever lives under another card. No-IO, no-JS, reduced-motion and keyboard-focus fallbacks remain visible. This adaptation needs owner visual review, not just green audits.

Run locally (Windows script-shell issue):

    npm ci --ignore-scripts
    npm --script-shell bash test -- --runInBand --testPathPatterns 'landing|home-page'
    npm --script-shell bash run build
    node scripts/prepare-standalone.mjs
    PORT=3518 HOSTNAME=127.0.0.1 node .next/standalone/apps/web/server.js
    LANDING_BASE_URL=http://127.0.0.1:3518 node scripts/verify-story-production.mjs
    LANDING_BASE_URL=http://127.0.0.1:3518 LANDING_AUDIT_MODE=disabled node scripts/verify-landing-production.mjs

Linux/CI uses normal npm scripts. The additive `Story production audit` workflow checks the exact pushed head independently; it does not replace/weaken existing Test jobs. The custom story audit covers every scene/leaf, overlapping text, clipping, viewport bounds, CTA contrast, catalogue/truth, axe, desktop/390/320/tablet/effective 200% viewport, no-JS/no-IO, scroll-trigger entrance, four demo stages, sidebar and Escape/focus. Only the already accepted native teaser geometry exception is reused; axe has no exclusions. Screenshots and JSON results remain uncommitted in apps/web/artifacts/story/.

Limits: no conversion lift is claimed; no paid work/publish/deploy/merge. Real analytics acquisition experiments require a later integration decision; this preview intentionally does not add tracking/consent obligations.
