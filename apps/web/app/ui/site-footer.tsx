import Link from "next/link";

import { readOperatorSession } from "../../lib/operator-auth";
import { OPERATOR_REQUISITES } from "../../lib/operatorRequisites";
import s from "./site-footer.module.css";
import { BrandLogo } from "./brand-logo";

/**
 * Site-wide footer — a quiet, minimal closer for every page surface.
 *
 * Three lines, no more: brand + nav links; one operator-requisites line (the
 * legally-required minimum — ФИО, ИНН, email); the copyright. The full
 * requisites (status, service description) live on /legal, so the footer
 * carries only what the law requires on every page and points to /legal for
 * the rest. Replaces the heavier footer that repeated the status and a
 * tagline-style copyright line.
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

        {/* Operator requisites — the legally-required minimum on every page:
            ФИО + ИНН + контактный email. Full status/service on /legal. The
            operator's identifying details live in one place (lib/operatorRequisites)
            so the footer and /legal never drift apart. These stay on every page
            by law (152-ФЗ / 54-ФЗ for a self-employed seller accepting payments
            online) — removing them would be a compliance regression. */}
        <div className={s.footerOperator}>
          <span className={s.footerOperatorName}>{OPERATOR_REQUISITES.fullName}</span>
          <span className={s.footerOperatorSep} aria-hidden="true">·</span>
          <span>ИНН <span className={s.footerOperatorInn}>{OPERATOR_REQUISITES.inn}</span></span>
          <span className={s.footerOperatorSep} aria-hidden="true">·</span>
          <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.footerOperatorEmail}>{OPERATOR_REQUISITES.email}</a>
        </div>

        <div className={s.footerCopy}>
          © {year} Recruiter Radar
        </div>
      </div>
    </footer>
  );
}
