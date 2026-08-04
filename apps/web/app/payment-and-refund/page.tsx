import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_DOCUMENTS } from "@/lib/legalDocuments";
import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";
import { PUBLIC_PLANS } from "@/lib/publicProduct";
import { PageFrame, SectionIntro } from "../ui/page-primitives";
import { SiteFooter } from "../ui/site-footer";
import s from "../ui/legal-document.module.css";

export const metadata: Metadata = {
  title: "Оплата, предоставление доступа и возврат — Recruiter Radar",
  description: "Способы оплаты, порядок предоставления цифрового доступа и условия возврата Recruiter Radar.",
  robots: { index: true, follow: true },
};

export default function PaymentAndRefundPage() {
  return (
    <PageFrame maxWidth="760px">
      <section className={s.docSection}>
        <SectionIntro
          eyebrow="Покупателям"
          title="Оплата, получение услуги и возврат"
          description="Понятный порядок разовой оплаты, активации цифрового доступа, выдачи чека НПД и возврата денежных средств."
        />

        <p className={s.docOperator}>
          Продавец: <strong>самозанятый {OPERATOR_REQUISITES.fullName}</strong>, ИНН {OPERATOR_REQUISITES.inn}. Контакт: {" "}
          <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.docLink}>{OPERATOR_REQUISITES.email}</a>. Редакция от {LEGAL_DOCUMENTS.paymentAndRefund.displayDate}.
        </p>

        <div className={s.docBody}>
          <PolicySection n="1" title="Что продаётся">
            <p>Recruiter Radar предоставляет цифровой доступ к информационно-аналитическому сервису для рекрутинговых агентств. Физический товар и физическая доставка отсутствуют.</p>
            <ul className={s.docList}>
              {PUBLIC_PLANS.map((plan) => (
                <li key={plan.code}><strong>{plan.name}</strong> — {plan.price}, доступ на {plan.cadence}, разовая оплата без автоматического продления.</li>
              ))}
            </ul>
          </PolicySection>

          <PolicySection n="2" title="Как проходит оплата">
            <ol className={s.docList}>
              <li>Покупатель выбирает тариф и до оплаты видит итоговую стоимость и срок доступа.</li>
              <li>Покупатель отдельно принимает публичную оферту и даёт согласие на обработку персональных данных.</li>
              <li>Оплата проводится на защищённой платёжной странице Robokassa.</li>
              <li>Recruiter Radar не получает и не хранит полный номер карты, срок её действия и CVC/CVV.</li>
              <li>Карта не сохраняется, автоматические и рекуррентные списания не выполняются.</li>
            </ol>
          </PolicySection>

          <PolicySection n="3" title="Когда предоставляется доступ">
            <p>После серверного подтверждения успешного платежа аккаунт получает оплаченный период доступа. Возврат браузера на сайт без подтверждения от Robokassa не считается доказательством оплаты.</p>
            <p>Страница настройки профиля становится доступна сразу после подтверждения платежа. Для получения персонализированных подборок покупатель заполняет профиль поиска и при желании подключает канал доставки. Работа канала Telegram зависит от его доступности и отдельного подключения пользователем.</p>
          </PolicySection>

          <PolicySection n="4" title="Чек самозанятого">
            <p>Продавец применяет специальный налоговый режим НПД. После получения оплаты формируется электронный чек через приложение «Мой налог» или подключённый сервис Robokassa «Робочеки СМЗ» и передаётся покупателю по предоставленному контакту.</p>
            <p>При полном или частичном возврате продавец выполняет предусмотренную НПД корректировку чека.</p>
          </PolicySection>

          <PolicySection n="5" title="Отказ от услуги и возврат">
            <p>Для запроса возврата покупатель направляет письмо на <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.docLink}>{OPERATOR_REQUISITES.email}</a> и указывает e-mail аккаунта, номер заказа, дату, сумму платежа и причину обращения.</p>
            <p>Если оплаченный доступ не был предоставлен по вине продавца, производится полный возврат. После начала оказания услуги размер возврата определяется с учётом фактически предоставленного периода, характера обращения и обязательных прав покупателя по законодательству Российской Федерации.</p>
            <p>Возврат может быть полным или частичным и проводится через Robokassa на исходный способ оплаты, когда это технически возможно. Срок зачисления после подтверждения возврата зависит от банка и платёжного метода.</p>
          </PolicySection>

          <PolicySection n="6" title="Что происходит с доступом при возврате">
            <p>Частичный возврат сам по себе не прекращает весь оплаченный доступ, если иное не согласовано с покупателем или не следует из основания возврата.</p>
            <p>После подтверждённого полного возврата соответствующий оплаченный период аннулируется. Если у пользователя есть другие действующие оплаченные заказы, срок доступа пересчитывается по ним.</p>
          </PolicySection>

          <PolicySection n="7" title="Ошибочный или повторный платёж">
            <p>При ошибочном повторном списании, неверной сумме или платеже, который не отразился в аккаунте, покупатель обращается в поддержку. Продавец сверяет заказ с серверным статусом Robokassa и не активирует доступ только на основании скриншота или страницы успешного возврата.</p>
          </PolicySection>

          <PolicySection n="8" title="Связанные документы">
            <p>Полные договорные условия содержатся в <Link href="/terms" className={s.docLink}>публичной оферте</Link>, порядок обработки данных — в <Link href="/privacy" className={s.docLink}>политике обработки персональных данных</Link>, реквизиты продавца — на странице <Link href="/legal" className={s.docLink}>«Реквизиты»</Link>.</p>
          </PolicySection>
        </div>
      </section>
      <SiteFooter />
    </PageFrame>
  );
}

function PolicySection({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className={s.docClause}>
      <h2 className={s.docClauseTitle}>{n}. {title}</h2>
      <div className={s.docClauseText}>{children}</div>
    </section>
  );
}
