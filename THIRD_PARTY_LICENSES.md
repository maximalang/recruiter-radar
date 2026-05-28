# Third-Party Licenses

This document tracks notable third-party software that Recruiter Radar
ships, links to its licenses, and notes any obligations that follow
the user (e.g. attribution, source-code disclosure, copyleft scope).

The full transitive license set is governed by `package.json` and
inspected via `npm`. Run `npm ls --all --json` for the authoritative
dependency tree at any commit. This file calls out only the licenses
that have practical implications for distribution, attribution, or
internal usage.

---

## Runtime dependencies of `apps/web`

| Package | License | Notes |
|---|---|---|
| `next` | MIT | First-party Next.js framework. |
| `react`, `react-dom` | MIT | Core UI runtime. |
| `pg` | MIT | PostgreSQL driver. |

All current first-party `dependencies` and `devDependencies` are
permissive (MIT / ISC / BSD / Apache-2.0). No copyleft (GPL, LGPL,
AGPL) deps ship with the product as of this commit.

## CLI / build dependencies

`jest`, `ts-jest`, `typescript`, `postcss`, `husky`, `ts-node`,
`@testing-library/*` are all permissive (MIT). They are not shipped
to end users and apply only to local development and CI builds.

---

## Planned future attribution slots

Some sources roadmap items will introduce dependencies that **do**
carry attribution or license-isolation obligations. Document each one
here at the same commit it lands:

### Crawl4AI (Slice G — `tasks/todo-sources-improvement.md`)

Status: **not yet integrated.**

When `Crawl4AI` is added as a Docker sidecar (per Slice G), record:
- pinned upstream version
- upstream license (Apache-2.0 at time of writing — verify before use)
- a link to the upstream repository
- the LLM models / weights used through it (if any), and their
  separate licenses
- whether Crawl4AI is invoked **as a network service** (no source
  obligation) or **bundled into the binary** (may invoke source
  obligations depending on the upstream license at integration time)

### Playwright + chromium (Slice D — `tasks/todo-sources-improvement.md`)

Status: **not yet integrated.**

When the Playwright crawler engine lands, record:
- `playwright` and `playwright-chromium` upstream versions and
  Apache-2.0 license
- a note that the bundled Chromium browser is BSD-style licensed and
  must not be redistributed outside Playwright's installer flow

### Firecrawl (Slice I — paid provider decision)

If Firecrawl is selected, note that the open-source self-host variant
is **AGPL-3.0** and would force source-disclosure of Recruiter Radar
under the network-use clause. The hosted SaaS subscription does not.
Pick one explicitly before integrating.

---

## Updating this file

When adding a dependency that is **not** MIT / ISC / BSD / Apache-2.0,
or when adding a Docker sidecar / runtime service, append a row above
in the same commit that introduces the dependency. Reviewers should
block PRs that add copyleft deps without an updated entry here.
