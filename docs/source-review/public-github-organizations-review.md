# Source Review: public GitHub organizations

**Reviewed:** 2026-08-13
**Classification:** A for the public API; optional context source not adopted
**Decision:** Keep planned until company ownership can be bound fail-closed.

## Official path

- GitHub's official REST endpoint `GET /orgs/{org}/repos` lists public
  organization repositories and can be used without authentication for public
  resources.
- The official unauthenticated limit is 60 requests/hour per originating IP;
  response headers expose `ETag`, pagination links, and rate-limit state.
- A controlled request to `https://api.github.com/orgs/github/repos?per_page=1`
  returned HTTP 200 with public repository data and an ETag on 2026-08-13.

## Why it is not an active source ID yet

The API is free and technically usable, but a company domain does not safely
imply a GitHub organization handle. Name search would create false company
ownership, and user accounts can look like organizations. A real adapter must
first discover an organization link from a company-owned page, verify that the
API object type is `Organization`, and retain that ownership lineage.

When implemented, collect only organization metadata and public repositories;
never enumerate personal developer profiles, members, emails, commits, or
contributors for lead generation. Events must remain low-weight company-level
technology context and never hiring proof. Use ETag/Last-Modified and bounded
pagination, and stop on rate limits rather than rotating identities.
