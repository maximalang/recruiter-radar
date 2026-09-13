import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  CHECKOUT_LEGAL_ARCHIVE_SET,
  LEGAL_DOCUMENTS,
  LEGAL_SET_REVISION,
  buildLegalAcceptanceAudit,
  type LegalAcceptanceAudit,
} from "@/lib/legalDocuments";

const archiveDir = path.resolve(process.cwd(), "lib/legal/archive");
const documentsDir = path.join(archiveDir, "documents");

const CHECKOUT_DOCUMENT_KEYS = [
  "terms",
  "paymentAndRefund",
  "privacy",
  "personalDataConsent",
] as const;

describe("legal revisions and archive", () => {
  it("records an archive snapshot for every checkout-facing current revision", async () => {
    for (const key of CHECKOUT_DOCUMENT_KEYS) {
      const revision = LEGAL_DOCUMENTS[key].revision;
      const snapshotPath = path.join(documentsDir, `${key}-${revision}.md`);
      const content = await readFile(snapshotPath, "utf8");
      expect(content).toContain(`Редакция: ${revision}`);
      expect(content.trim().length).toBeGreaterThan(400);
    }
  });

  it("manifest hashes match the archived snapshots", async () => {
    const manifest = JSON.parse(await readFile(path.join(archiveDir, "manifest.json"), "utf8")) as {
      entries: Record<string, string>;
    };
    const files = (await readdir(documentsDir)).filter((name) => name.endsWith(".md")).sort();

    expect(Object.keys(manifest.entries).sort()).toEqual(files);

    for (const name of files) {
      const content = await readFile(path.join(documentsDir, name));
      const digest = createHash("sha256").update(content).digest("hex");
      expect(manifest.entries[name]).toBe(digest);
    }
  });

  it("checkout acceptance audit captures the exact current revision set", () => {
    const audit: LegalAcceptanceAudit = buildLegalAcceptanceAudit("2026-08-21T10:00:00.000Z");

    expect(audit.acceptedAt).toBe("2026-08-21T10:00:00.000Z");
    expect(audit.legalSetRevision).toBe(LEGAL_SET_REVISION);
    expect(audit.termsRevision).toBe(LEGAL_DOCUMENTS.terms.revision);
    expect(audit.paymentAndRefundRevision).toBe(LEGAL_DOCUMENTS.paymentAndRefund.revision);
    expect(audit.privacyRevision).toBe(LEGAL_DOCUMENTS.privacy.revision);
    expect(audit.personalDataConsentRevision).toBe(LEGAL_DOCUMENTS.personalDataConsent.revision);
  });

  it("archive set covers exactly the checkout documents", () => {
    expect(CHECKOUT_LEGAL_ARCHIVE_SET.documents).toEqual([...CHECKOUT_DOCUMENT_KEYS]);
    expect(CHECKOUT_LEGAL_ARCHIVE_SET.legalSetRevision).toBe(LEGAL_SET_REVISION);
  });

  it("revisions are ISO dates in YYYY-MM-DD form", () => {
    for (const [key, document] of Object.entries(LEGAL_DOCUMENTS)) {
      expect(document.revision).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(document.displayDate.length).toBeGreaterThan(0);
      // personalDataConsent semantics did not change in this release; others did.
      if (key !== "personalDataConsent" && key !== "legal") {
        expect(document.revision >= "2026-08-21").toBe(true);
      }
    }
  });
});
