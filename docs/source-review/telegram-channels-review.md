# Source Review: telegram-channels (Telegram vacancy channels)

**Date:** 2026-06-30
**Status:** ❌ NOT ADOPTED — rejected by standing policy; no compliant, evidence-grade path
**Decision:** Do not implement a Telegram-channel vacancy source.

## What was proposed

A source that reads public Telegram vacancy channels (e.g. recruiting / "вакансии"
channels) for hiring signals, via one of:
1. Public web preview (`https://t.me/s/<channel>`) HTML scraping, or
2. Bot API (`getUpdates` / channel membership), or
3. MTProto client libraries (telethon / gramjs / TDLib).

## Findings

### 1. It is rejected by standing policy

`docs/source-priority-policy.md` §"Rejected by default" and `docs/source-registry.md`
§"Rejected / not adopted" already list **Telegram / WhatsApp / social scrapers** as rejected:
social/personal scraping is out of product scope and conflicts with the product's
evidence-first and privacy stance (CLAUDE.md Product Identity: "It is NOT … candidate
sourcing"; "mass outreach/spam tool"). This review does not overturn that — it records the
fresh re-evaluation requested in the source-expansion pass and confirms the verdict.

### 2. No compliant, maintainable access path

- **Public preview (`/s/`) scraping:** unstable markup, no robots contract we can establish
  from here (the domain was unreachable from the build environment — `t.me` connections
  time out, so even a robots.txt check could not be completed), and a scrape-past-shell
  posture the project's security rules discourage.
- **Bot API:** a bot only receives channel posts where it is an administrator member — it
  cannot read arbitrary public channels. This requires per-channel admin consent we do not
  have and does not scale to discovery.
- **MTProto (telethon/gramjs/TDLib):** operates as a *user account*, against Telegram's ToS
  for automated scraping, and pulls personal-data-adjacent content (poster identity, contact
  handles) the normalizers are explicitly built to strip. Active-evasion / ToS-violating
  posture — disallowed.

### 3. It would not improve evidence, only add noise

Telegram vacancy channels are overwhelmingly **reposts and aggregations** of postings that
already originate on HH / career pages / job boards — exactly the "platform-only aggregation"
that lands at Gate C/D and the "more leads without better evidence" pattern CLAUDE.md forbids.
Channel posts rarely carry a clean company legal identity (INN/OGRN/domain), so they fail the
entity-resolution and privacy invariants in `source-registry.md` §"Privacy & identity
invariants". A channel post is **context at best, never direct hiring proof**.

## Conclusion

No compliant ingestion path, conflicts with the product's evidence/privacy stance, and adds
aggregation noise rather than evidence. **Not adopted.** Building a half-wired adapter we
cannot verify (no `t.me` egress here) would violate the "do not leave half-wired adapters /
do not pretend a source is live" delivery rule.

Re-open only if all of these hold: (a) an official Telegram **partner/provider** API with
documented terms exists, (b) it returns employer-published vacancy data with resolvable
company identity, and (c) a confidence verifier proves Gate B/A evidence — at which point it
would enter as a `confidence-gated-evidence` provider-token source, never as a scraper.
