import Link from "next/link";

import { readOperatorSession } from "../../lib/operator-auth";
import { OPERATOR_REQUISITES } from "../../lib/operatorRequisites";
import s from "./site-footer.module.css";
import { BrandLogo } from "./brand-logo";

/**
 * Robokassa moderation requires the self-employed seller's full name and INN
 * in the footer. Public support contacts stay visible while the visual layer
 * keeps the footer quiet and consistent with the product shell.
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
            <Link href="/offer" className={s.footerLink}>Оферта</Link>
            <Link href="/payment-and-refund" className={s.footerLink}>Оплата и возврат</Link>
            <Link href="/privacy" className={s.footerLink}>Конфиденциальность</Link>
            {isOperator ? <Link href="/admin" className={s.footerLink}>Оператор</Link> : null}
            {isOperator ? <Link href="/admin/payments" className={s.footerLink}>Платежи</Link> : null}
          </nav>
        </div>

        <div className={s.footerOperator}>
          <span className={s.footerOperatorName}>Самозанятый {OPERATOR_REQUISITES.fullName}</span>
          <span className={s.footerOperatorSep} aria-hidden="true">·</span>
          <span>ИНН <span className={s.footerOperatorInn}>{OPERATOR_REQUISITES.inn}</span></span>
          {OPERATOR_REQUISITES.city ? (
            <>
              <span className={s.footerOperatorSep} aria-hidden="true">·</span>
              <span>{OPERATOR_REQUISITES.city}</span>
            </>
          ) : null}
          <span className={s.footerOperatorSep} aria-hidden="true">·</span>
          <a href="tel:+79009666092" className={s.footerOperatorEmail}>{OPERATOR_REQUISITES.phone}</a>
          <span className={s.footerOperatorSep} aria-hidden="true">·</span>
          <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.footerOperatorEmail}>{OPERATOR_REQUISITES.email}</a>
        </div>

        <div className={s.footerCopy}>© {year} Recruiter Radar</div>
      </div>
    </footer>
  );
}
