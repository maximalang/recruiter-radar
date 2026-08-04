import Link from "next/link";

import { readOperatorSession } from "../../lib/operator-auth";
import { OPERATOR_REQUISITES } from "../../lib/operatorRequisites";
import s from "./site-footer.module.css";
import { BrandLogo } from "./brand-logo";

/**
 * Site-wide footer. Robokassa requires a self-employed seller's full name and
 * INN in the footer, so identity is kept here in one quiet line and not
 * repeated across product screens. Full details live on /legal.
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
            {isOperator ? <Link href="/admin" className={s.footerLink}>Оператор</Link> : null}
            {isOperator ? <Link href="/admin/payments" className={s.footerLink}>Платежи</Link> : null}
          </nav>
        </div>

        <div className={s.footerOperator}>
          <span className={s.footerOperatorName}>Самозанятый {OPERATOR_REQUISITES.fullName}</span>
          <span className={s.footerOperatorSep} aria-hidden="true">·</span>
          <span>ИНН <span className={s.footerOperatorInn}>{OPERATOR_REQUISITES.inn}</span></span>
          <span className={s.footerOperatorSep} aria-hidden="true">·</span>
          <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.footerOperatorEmail}>{OPERATOR_REQUISITES.email}</a>
        </div>

        <div className={s.footerCopy}>© {year} Recruiter Radar</div>
      </div>
    </footer>
  );
}
