# Dependency runtime debt

Verified on 2026-08-12 against the committed npm workspace and lockfile.

## Current finding

The deprecated-package warnings for `inflight`, `glob@7`, `whatwg-encoding`,
`domexception`, and `abab` are confined to the build/test dependency graph.
None of the five packages is imported directly by application or database code.
The production image installs the full graph only in its builder stage; the
runtime stage is assembled from Next.js standalone output and explicitly copied
runtime modules, so these packages are not copied as production runtime
dependencies.

`npm audit --omit=dev --audit-level=high` reported zero vulnerabilities on
2026-08-12. This is security evidence, not a claim that the deprecated packages
are current or should remain indefinitely.

## Parent chains

| Deprecated package | Current parent chain | Removal boundary |
| --- | --- | --- |
| `inflight@1.0.6` | `glob@7.2.3` -> Jest 29 runtime/config/reporting and Istanbul `test-exclude` | Coordinated Jest/coverage migration |
| `glob@7.2.3` | Jest 29 runtime/config/reporting and Istanbul `test-exclude` | Coordinated Jest/coverage migration |
| `whatwg-encoding@2.0.0` | `html-encoding-sniffer@3` / `jsdom@20` -> `jest-environment-jsdom@29` | Jest DOM environment major migration |
| `domexception@4.0.0` | `jsdom@20` -> `jest-environment-jsdom@29` | Jest DOM environment major migration |
| `abab@2.0.6` | `data-urls@3` / `jsdom@20` -> `jest-environment-jsdom@29` | Jest DOM environment major migration |

The root manifest also contains historical direct pins for these transitive
packages as part of a broadly flattened dependency list. Removing only five
pins would not remove the transitive packages or warnings and would leave the
larger manifest contract inconsistent.

## Decision and follow-up gate

Do not add overrides for deprecated leaf packages and do not replace individual
Jest internals independently. Upgrade them in one dedicated dependency change:

1. move Jest, `jest-environment-jsdom`, `babel-jest`, and compatible `ts-jest`
   together;
2. regenerate the lockfile with `npm ci` reproducibility preserved;
3. run the complete web unit/type/build matrix and browser acceptance suite;
4. verify `npm explain` no longer reaches the five deprecated packages;
5. verify the standalone production image contains only required runtime
   modules and `npm audit --omit=dev --audit-level=high` remains green.

Jest 30 is compatible with the declared `ts-jest@29.4` peer range, but changing
the test runner and DOM implementation remains a major ecosystem migration and
is intentionally outside this production-completion pass.
