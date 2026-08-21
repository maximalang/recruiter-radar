import Link from "next/link";

import { BrandLogo } from "./brand-logo";
import s from "./legal-document.module.css";

const PRIMARY_DOCUMENTS = [
  { href: "/legal", label: "Реквизиты" },
  { href: "/terms", label: "Оферта" },
  { href: "/payment-and-refund", label: "Оплата" },
  { href: "/privacy", label: "Политика" },
  { href: "/personal-data-consent", label: "Согласие" },
] as const;

const SECONDARY_DOCUMENTS = [
  { href: "/cookies", label: "Cookies" },
  { href: "/acceptable-use", label: "Правила" },
  { href: "/data-policy", label: "Источники данных" },
] as const;

export function LegalDocumentNav({ current }: { current: string }) {
  const isSecondary = SECONDARY_DOCUMENTS.some((document) => document.href === current);

  return (
    <nav className={s.docNav} aria-label="Юридические документы">
      <div className={s.docNavBrand}>
        <Link href="/" className={s.docBrandLink} aria-label="Recruiter Radar — на главную">
          <BrandLogo size="small" joined />
        </Link>
        <span className={s.docNavLabel}>Документы</span>
      </div>

      <div className={s.docNavLinks}>
        {PRIMARY_DOCUMENTS.map((document) => (
          <Link
            key={document.href}
            href={document.href}
            className={s.docNavLink}
            aria-current={document.href === current ? "page" : undefined}
          >
            {document.label}
          </Link>
        ))}
        <details className={s.docNavMore} {...(isSecondary ? { open: true } : {})}>
          <summary className={s.docNavLink}>Ещё</summary>
          <div className={s.docNavMoreLinks}>
            {SECONDARY_DOCUMENTS.map((document) => (
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
        </details>
      </div>

      <Link href="/" className={s.docNavAction}>
        На сайт
        <span aria-hidden="true">↗</span>
      </Link>
    </nav>
  );
}
