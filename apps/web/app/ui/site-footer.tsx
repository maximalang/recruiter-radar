import Link from "next/link";

import { readOperatorSession } from "../../lib/operator-auth";
import s from "./site-footer.module.css";
import { BrandLogo } from "./brand-logo";

/**
 * Shared site footer. Full seller requisites live on /legal; product pages keep
 * only navigation to the legal documents so the landing and app remain clean.
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
          <nav className={s.footerLinks} aria-label="Юридическая информация">
            <Link href="/terms" className={s.footerLink}>Оферта</Link>
            <Link href="/privacy" className={s.footerLink}>Конфиденциальность</Link>
            <Link href="/legal" className={s.footerLink}>Реквизиты</Link>
            {isOperator ? (
              <Link href="/admin" className={s.footerLink}>Панель оператора</Link>
            ) : null}
          </nav>
        </div>

        <div className={s.footerCopy}>© {year} Recruiter Radar</div>
      </div>
    </footer>
  );
}
