import Link from "next/link";

import { OPERATOR_REQUISITES } from "../../lib/operatorRequisites";
import s from "./site-footer.module.css";
import { BrandLogo } from "./brand-logo";

const PRODUCT_LINKS = [
  { href: "/#scene-timeline", label: "Почему сейчас" },
  { href: "/#scene-workspace", label: "Рабочая выдача" },
  { href: "/#scene-evidence", label: "Факты и источники" },
  { href: "/#pricing", label: "Тарифы" },
  { href: "/#faq", label: "FAQ" },
] as const;

const SERVICE_LINKS = [
  { href: "/login?returnTo=%2Fdashboard", label: "Войти" },
  { href: "/dashboard", label: "Кабинет" },
] as const;

const DOCUMENT_LINKS = [
  { href: "/legal", label: "Правовая информация", ariaLabel: "Правовая информация — Реквизиты" },
  { href: "/privacy", label: "Конфиденциальность", ariaLabel: "Политика конфиденциальности" },
  { href: "/terms", label: "Условия использования", ariaLabel: "Условия использования — Оферта" },
  { href: "/personal-data-consent", label: "Обработка данных", ariaLabel: "Согласие на обработку персональных данных" },
  { href: "/payment-and-refund", label: "Оплата и возврат", ariaLabel: "Информация об оплате и возврате" },
] as const;

export async function SiteFooter(props: { tone?: "light" | "dark" }) {
  const tone = props.tone ?? "light";
  const year = new Date().getFullYear();

  return (
    <footer className={s.siteFooter} data-tone={tone}>
      <div className={s.footerInner}>
        <div className={s.footerMain}>
          <div className={s.footerIdentity}>
            <Link href="/" className={s.footerBrand} aria-label="Recruiter Radar — на главную">
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
            <p className={s.footerLine}>
              Проверяемые сигналы найма — чтобы понимать, какой компании стоит написать сейчас и почему.
            </p>
          </div>

          <div className={s.footerNav}>
            <nav aria-label="Продукт">
              <strong>Продукт</strong>
              {PRODUCT_LINKS.map((item) => <Link key={item.href} href={item.href} className={s.footerLink}>{item.label}</Link>)}
            </nav>
            <nav aria-label="Сервис">
              <strong>Сервис</strong>
              {SERVICE_LINKS.map((item) => <Link key={item.href} href={item.href} className={s.footerLink}>{item.label}</Link>)}
            </nav>
            <nav aria-label="Документы">
              <strong>Документы</strong>
              {DOCUMENT_LINKS.map((item) => <Link key={item.href} href={item.href} aria-label={item.ariaLabel} className={s.footerLink}>{item.label}</Link>)}
            </nav>
          </div>
        </div>

        <div className={s.footerBottom}>
          <div className={s.footerOperator}>
            <span className={s.footerOperatorName}>Самозанятый {OPERATOR_REQUISITES.fullName}</span>
            <span className={s.footerOperatorSep} aria-hidden="true">·</span>
            <span>ИНН <span className={s.footerOperatorInn}>{OPERATOR_REQUISITES.inn}</span></span>
            <span className={s.footerOperatorSep} aria-hidden="true">·</span>
            <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.footerOperatorEmail}>{OPERATOR_REQUISITES.email}</a>
          </div>
          <div className={s.footerCopy}>© {year} Recruiter Radar</div>
        </div>
      </div>
    </footer>
  );
}
