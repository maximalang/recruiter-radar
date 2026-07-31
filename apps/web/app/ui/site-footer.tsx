import Link from "next/link";

import { readOperatorSession } from "../../lib/operator-auth";
import { OPERATOR_REQUISITES } from "../../lib/operatorRequisites";
import s from "./site-footer.module.css";
import { BrandLogo } from "./brand-logo";

/**
 * Site-wide footer — a quiet, minimal closer for every page surface.
 *
 * Three lines, no more: brand + nav links; one operator-requisites line (ФИО,
 * ИНН and contacts); the copyright. The full status and service description
 * live on /legal. Public operator data is imported from one source of truth.
 *
 * The /admin link is operator-gated: it renders ONLY for a browser that
 * carries the signed `rr_op` operator session (see lib/operator-auth.ts).
 * The /admin page itself is auth-gated too, but the link must not advertise
 * the operator panel to ordinary users on the public landing/legal pages.
 * Server-side check (server component), so the link is absent from the HTML.
 *
 * `tone` lets a dark surface request the light-on-dark variant; internal +
 * legal pages use the default light tone.
 */
export async function SiteFooter(props: { tone?: "light" | "dark" }) {
  const tone = props.tone ?? "light";
  const year = new Date().getFullYear();
  const isOperator = await readOperatorSession().catch(() => false);
  return (
    <footer className={s.siteFooter} data-tone={tone}>
      <div className={s.footerInner}>
        <div className={s.footerTop}>
          <Link href="/" className={s.footerBrand}>
            <img
              className={s.footerMark}
              src="/brand/recruiter-radar-mark-brand15.svg"
              width={48}
              height={48}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
            <BrandLogo size="small" tone={tone} joined={false} />
          </Link>
          <nav className={s.footerLinks} aria-label="Подвал">
            <Link href="/legal" className={s.footerLink}>Реквизиты</Link>
            <Link href="/terms" className={s.footerLink}>Оферта</Link>
            <Link href="/privacy" className={s.footerLink}>Конфиденциальность</Link>
            {isOperator ? (
              <Link href="/admin" className={s.footerLink}>Панель оператора</Link>
            ) : null}
          </nav>
        </div>

        <div className={s.footerOperator}>
          <span className={s.footerOperatorName}>{OPERATOR_REQUISITES.fullName}</span>
          <span className={s.footerOperatorSep} aria-hidden="true">·</span>
          <span>ИНН <span className={s.footerOperatorInn}>{OPERATOR_REQUISITES.inn}</span></span>
          <span className={s.footerOperatorSep} aria-hidden="true">·</span>
          <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.footerOperatorEmail}>{OPERATOR_REQUISITES.email}</a>
          {OPERATOR_REQUISITES.phone ? (
            <>
              <span className={s.footerOperatorSep} aria-hidden="true">·</span>
              <a
                href={`tel:${OPERATOR_REQUISITES.phone.replace(/[^+\d]/g, "")}`}
                className={s.footerOperatorEmail}
              >
                {OPERATOR_REQUISITES.phone}
              </a>
            </>
          ) : null}
        </div>

        <div className={s.footerCopy}>
          © {year} Recruiter Radar
        </div>
      </div>
    </footer>
  );
}
