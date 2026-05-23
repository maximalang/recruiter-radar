# Source Blockers and Provider Shortlist

## Overview

This document provides an honest operational report on source readiness, blockers, and API-mega-list provider selection for Recruiter Radar.

## Current Production Status

### ✅ ACTIVE - Production Ready

#### P1 Core Sources
- **hh**: Primary platform source
  - Status: Active with controlled live mode
  - Blocker: Requires real `HH_USER_AGENT` registered app/contact identity
  - Ready: Yes, with proper environment setup
  - Digest: Allowed with confidence gate

- **career-pages**: Company career pages
  - Status: Active
  - Blocker: None when targets are curated
  - Ready: Yes
  - Digest: Allowed with confidence gate

#### P2 Ready with Gated Access
- **company-site**: Company websites (non-career sections)
  - Status: Active
  - Blocker: Generic pages only support existing evidence
  - Ready: Yes
  - Digest: Supporting evidence only

- **funding-business-signals**: Contextual business signals
  - Status: Active via GDELT
  - Blocker: Context only, never lead-originating
  - Ready: Yes
  - Digest: Never lead-originating

### ⚠️ GATED - Ready but Restricted

#### P1 Sources
- **rabota-rossii**: Official Rabota Rossii API
  - Status: Runnable with official API
  - Blocker: Confidence gate tests pending
  - Ready: Yes, but blocked from digest
  - Digest: Blocked until confidence tests pass

- **egrul-fns**: Company registry
  - Status: Runnable
  - Blocker: Entity enrichment only, never lead-originating
  - Ready: Yes
  - Digest: Never lead-originating

- **transparent-business-fns**: Business context
  - Status: Provider/file only
  - Blocker: No stable lawful public API
  - Ready: Yes with provider
  - Digest: Never lead-originating

- **fedresurs**: Corporate events registry
  - Status: Provider/file only
  - Blocker: Public site blocked by Qrator/401
  - Ready: Yes with provider
  - Digest: Never lead-originating

#### P2 Sources
- **tech-job-boards**: Greenhouse/Lever/other tech boards
  - Status: Provider/fixture ready
  - Blocker: Confidence gate tests required
  - Ready: Yes, but blocked from digest
  - Digest: Blocked until confidence tests

- **linkedin-company-pages**: LinkedIn employer pages
  - Status: Provider/snapshot only
  - Blocker: No compliant free public path
  - Ready: Yes with provider
  - Digest: Blocked until confidence tests

- **superjob**: SuperJob vacancies
  - Status: Provider/snapshot only
  - Blocker: Anonymous API not production path
  - Ready: Yes with `SUPERJOB_API_APP_ID`
  - Digest: Blocked until confidence tests

- **habr-career**: Habr Career IT jobs
  - Status: Provider/snapshot only
  - Blocker: Direct HTML requires robots/legal review
  - Ready: Yes with provider
  - Digest: Blocked until confidence tests

### 🔒 CONTEXT ONLY - Supporting Role Only

#### P3 Sources
- **company-newsrooms**: Company press centers
  - Status: Curated targets only
  - Blocker: Supporting context never leads alone
  - Ready: Yes
  - Digest: Never lead-originating

- **industry-media**: Industry media coverage
  - Status: Curated/provider only
  - Blocker: Publisher domains ≠ company identity
  - Ready: Yes
  - Digest: Never lead-originating

- **regional-job-boards**: Regional job boards
  - Status: Provider/snapshot per board
  - Blocker: Legal/robots review required per board
  - Ready: Yes with provider
  - Digest: Blocked until confidence gates

## API-Mega-List Provider Shortlist

### Tier A - Quality Candidates for tech-job-boards

#### All Jobs Scraper - LinkedIn, Indeed, Glassdoor
- **Status**: Candidate for tech-job-boards provider integration
- **Acceptance Criteria**:
  - ✅ Vacancy-level records only
  - ✅ Employer identity required
  - ✅ Region, salary, source URL, freshness included
  - ❌ No personal contact fields
  - ❌ No job URLs as org identity
- **Integration Path**: Provider fixture → tech-job-boards normalization
- **RF Priority**: Secondary after P1 core

#### LinkedIn Jobs Scraper with Company Insights (No Cookies)
- **Status**: Optional provider evidence
- **Acceptance Criteria**:
  - ✅ Company-level insights only
  - ❌ All employee/profile/contact fields must be dropped
  - ❌ No personal enrichment
- **Integration Path**: Optional corroborating layer
- **RF Priority**: Low, context only

### Tier B - Optional Coverage

#### Indeed Scraper / Glassdoor Jobs Scraper
- **Status**: Optional secondary job coverage
- **RF Priority**: Not core to Russian recruitment
- **Use Case**: Broader market context when available
- **Blockers**: Legal/robots review required per region

#### Wellfound Job Scraper / Y Combinator Jobs
- **Status**: Startup/tech context
- **RF Priority**: Lower for general Russian agencies
- **Use Case**: IT agencies with startup focus
- **Integration**: Context enrichment only

#### BuiltWith-style Company Scrapers
- **Status**: Company-level tech stack
- **RF Priority**: Enrichment only
- **Blocker**: Must have no personal contacts

### ❌ REJECTED BY DEFAULT

#### Personal Contact Scrapers
- **Reject Reason**: Violates compliance-first principles
- **Examples**:
  - Apollo/ZoomInfo/Lusha alternatives with emails/phones
  - LinkedIn profile/email/phone/employee scrapers
  - Google Maps email/phone/social scrapers
  - Telegram/WhatsApp/social profile/member scrapers

#### Mass Outreach Tools
- **Reject Reason**: Not intelligence gathering
- **Examples**: Any email campaign, bulk messaging actors

## Honest Blockers Report

### Environment Blockers
- **Production live config missing**: Most sources require env/snapshot inputs
- **HH_USER_AGENT not real**: Placeholder requests rejected by HH
- **Provider credentials**: Many P2/P3 sources require paid provider access
- **DB dependency**: Digest validation requires reachable Postgres

### Legal/Compliance Blockers
- **Robots.txt compliance**: Direct scraping requires review
- **Personal data**: No email/phone collection in MVP core
- **Regional restrictions**: Some sources have geographic limitations

### Quality Blockers
- **API-mega-list not guaranteed**: Every candidate needs fixture testing
- **Sensitive field rejection**: Must prove no personal data leakage
- **Confidence gates**: New sources cannot create hot leads until tested

## Next Steps

1. **Immediate**:
   - Set up production environment for P1 sources
   - Run `npm run verify:sources:coverage` to validate setup
   - Configure `HH_USER_AGENT` with real app identity

2. **Short Term**:
   - Test confidence gates for P2 candidates
   - Add provider fixtures for API-mega-list Tier A
   - Complete legal review for direct sources

3. **Long Term**:
   - Expand P2/P3 as confidence tests pass
   - Implement personal contact module separately
   - Continuous quality monitoring for all sources

## Production Checklist

Before any source promotion to digest:
- [ ] Verify source has smoke fixtures
- [ ] Check sensitive fields are dropped
- [ ] Validate org identity through domain/INN/verified ID
- [ ] Run confidence gate tests
- [ ] Document production blockers
- [ ] Get legal approval if required

> **Remember**: RF-quality over quantity. P1 production-readiness first.