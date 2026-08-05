import Link from "next/link";

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
    </nav>
  );
}
