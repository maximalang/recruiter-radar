import Link from "next/link";

import { readOperatorSession } from "../../lib/operator-auth";
import s from "./site-footer.module.css";

/**
 * Site-wide footer — a premium, minimal closer for every page surface.
 *
 * One vocabulary across the landing page, internal app pages, and legal
 * pages: a thin top rule, a brand mark + a row of quiet navigation links,
 * then a single compact operator line (ФИО · статус · ИНН · email) and the
 * copyright. The operator requisites are the legally-required minimum
 * (ФЗ-54 / НПД) — kept on one line, mono INN, no heavy card so it reads as
 * restraint rather than a form. Replaces the per-page inline footers and the
 * `← На главную` link rows that used the forbidden literal glyph.
 *
 * The /admin link is operator-gated: it renders ONLY for a browser that
 * carries the signed `rr_op` operator session (see lib/operator-auth.ts).
 * The /admin page itself is auth-gated too, but the link must not advertise
 * the operator panel to ordinary users on the public landing/legal pages —
 * admin surfaces are not a public site function. The check is server-side
 * (this is a server component), so the link is absent from the HTML, not
 * merely hidden.
 *
 * `tone` lets a dark hero/landing surface request the light-on-dark variant;
 * internal + legal pages use the default light tone.
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
            Recruiter Radar
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
          <span className={s.footerOperatorName}>Головий Наталья Ярославна</span>
          <span className={s.footerOperatorSep} aria-hidden="true">·</span>
          <span>самозанятый, плательщик НПД</span>
          <span className={s.footerOperatorSep} aria-hidden="true">·</span>
          <span>ИНН <span className={s.footerOperatorInn}>622809740837</span></span>
          <span className={s.footerOperatorSep} aria-hidden="true">·</span>
          <a href="mailto:6uunn9@gmail.com" className={s.footerOperatorEmail}>6uunn9@gmail.com</a>
        </div>

        <div className={s.footerCopy}>
          © {year} Recruiter Radar. Ежедневный радар по компаниям с активным наймом.
        </div>
      </div>
    </footer>
  );
}
