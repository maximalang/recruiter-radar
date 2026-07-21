# UX hardening verification

## Repository state

The implementation work described as Phase 7 in `tasks/todo.md` is already present in runtime code even where historical task checkboxes were not updated:

- leads and review use shared `LoadingState` skeletons;
- dashboard, leads and review use human `ErrorState`/`NoticeBox` paths;
- raw backend error messages are not rendered on those primary data surfaces;
- literal interface-glyph and mojibake audits have regression tests;
- shared empty/loading primitives are used across internal pages.

Historical unchecked boxes are not treated as proof that runtime is incomplete. Code and tests remain the source of truth.

## Browser verification added in this pass

`scripts/verify-responsive-surfaces.mjs` checks these routes at 375×812 and 1280×900:

- landing;
- login;
- checkout;
- dashboard;
- leads;
- review;
- profile;
- settings/profile;
- admin.

For each route it records:

- HTTP status and final URL;
- horizontal overflow (`scrollWidth > innerWidth`);
- visible button/form targets below 44 px;
- unlabeled icon-only links/buttons;
- browser console/page errors;
- full-page screenshot.

GitHub Actions uploads the screenshots and JSON report as `responsive-surface-audit`.

## Honest limitation

CI exercises public, unauthenticated, redirect, empty and degraded states against a clean PostgreSQL database. Fully populated authenticated lead/dashboard/review states require a deterministic seed account and session fixture or a separate staging account. They are not claimed as visually approved until that fixture/staging pass exists.

This limitation does not disable the browser audit; it clearly separates the states verified automatically from states that still require staging data.
