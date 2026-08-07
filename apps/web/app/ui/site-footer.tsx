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
  { href: "/login", label: "Войти" },
  { href: "/dashboard", label: "Кабинет" },
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
              <Link href="/legal" aria-label="Правовая информация — Реквизиты" className={s.footerLink}>Правовая информация</Link>
              <Link href="/privacy" aria-label="Конфиденциальность — Политика конфиденциальности" className={s.footerLink}>Политика конфиденциальности</Link>
              <Link href="/terms" aria-label="Условия использования — Оферта" className={s.footerLink}>Условия использования</Link>
              <Link href="/personal-data-consent" aria-label="Согласие на обработку персональных данных" className={s.footerLink}>Обработка данных</Link>
              <Link href="/payment-and-refund" aria-label="Информация об оплате и возврате" className={s.footerLink}>Оплата и возврат</Link>
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