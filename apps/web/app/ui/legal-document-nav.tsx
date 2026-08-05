import Link from "next/link";

import { BrandLogo } from "./brand-logo";
import s from "./legal-document.module.css";

const DOCUMENTS = [
  { href: "/legal", label: "Реквизиты" },
  { href: "/terms", label: "Оферта" },
  { href: "/payment-and-refund", label: "Оплата и возврат" },
  { href: "/privacy", label: "Политика ПДн" },
  { href: "/personal-data-consent", label: "Согласие ПДн" },
] as const;

export function LegalDocumentNav({ current }: { current: string }) {
  return (
    <nav className={s.docNav} aria-label="Юридические документы">
      <div className={s.docNavBrand}>
        <Link href="/" className={s.docBrandLink} aria-label="Recruiter Radar — на главную">
          <BrandLogo size="small" joined />
        </Link>
        <span className={s.docNavLabel}>Документы</span>
      </div>

      <div className={s.docNavLinks}>
        {DOCUMENTS.map((document) => (
          <Link
            key={document.href}
            href={document.href}
            className={s.docNavLink}
            aria-current={document.href === current ? "page" : undefined}
          >
            {document.label}
          </Link>
        ))}
      </div>

      <Link href="/" className={s.docNavAction}>
        На сайт
        <span aria-hidden="true">↗</span>
      </Link>
    </nav>
  );
}
