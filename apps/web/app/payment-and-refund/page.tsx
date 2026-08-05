import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_DOCUMENTS } from "@/lib/legalDocuments";
import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";
import { PUBLIC_PLANS } from "@/lib/publicProduct";
import { PageFrame, SectionIntro } from "../ui/page-primitives";
import { LegalDocumentNav } from "../ui/legal-document-nav";
import { SiteFooter } from "../ui/site-footer";
import s from "../ui/legal-document.module.css";

export const metadata: Metadata = {
  title: "Оплата, предоставление доступа и возврат — Recruiter Radar",
  description: "Способы оплаты, порядок предоставления цифрового доступа и условия возврата Recruiter Radar.",
  robots: { index: true, follow: true },
};

export default function PaymentAndRefundPage() {
  return (
    <PageFrame maxWidth="800px">
      <section className={s.docSection}>
        <LegalDocumentNav current="/payment-and-refund" />
        <SectionIntro
          eyebrow="Покупателям"
          title="Оплата, получение услуги и возврат"
          description="Разовая оплата, точный момент активации, электронный чек НПД и прозрачный расчёт возврата."
        />

        <p className={s.docOperator}>
          Продавец: <strong>самозанятый {OPERATOR_REQUISITES.fullName}</strong>, ИНН {OPERATOR_REQUISITES.inn}, {OPERATOR_REQUISITES.city}. Контакт: {" "}
          <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.docLink}>{OPERATOR_REQUISITES.email}</a>. Редакция от {LEGAL_DOCUMENTS.paymentAndRefund.displayDate}.
        </p>

        <div className={s.docSummary}>
          <Summary label="Тип платежа" value="Разовый · без автосписаний" />
          <Summary label="Предоставление" value="Цифровой доступ после ResultURL" />
          <Summary label="Возврат" value="Полный или за неиспользованный срок" />
        </div>

        <p className={s.docCallout}>
          <strong>Главное:</strong> страница «успешно» в браузере сама по себе не активирует заказ. Доступ появляется только после подписанного серверного подтверждения Robokassa.
        </p>

        <div className={s.docBody}>
          <PolicySection n="1" title="Что продаётся">
            <p>Recruiter Radar предоставляет ограниченный по времени цифровой доступ к информационно-аналитическому сервису для рекрутинговых агентств. Физический товар и физическая доставка отсутствуют.</p>
            <div className={s.docTableWrap}>
              <table className={s.docTable}>
                <thead><tr><th>Тариф</th><th>Срок</th><th>Стоимость</th><th>Продление</th></tr></thead>
                <tbody>
                  {PUBLIC_PLANS.map((plan) => (
                    <tr key={plan.code}><td><strong>{plan.name}</strong></td><td>{plan.cadence}</td><td>{plan.price}</td><td>Только новым заказом</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PolicySection>

          <PolicySection n="2" title="Как проходит оплата">
            <ol className={s.docList}>
              <li>Покупатель выбирает тариф и до перехода в Robokassa видит услугу, срок и итоговую стоимость.</li>
              <li>Покупатель отдельно принимает публичную оферту и даёт согласие на обработку персональных данных.</li>
              <li>ООО или ИП указывает ИНН покупателя для корректного чека НПД.</li>
              <li>Карта, СБП и иные платёжные реквизиты вводятся на защищённой странице Robokassa.</li>
              <li>Recruiter Radar не получает полный номер карты, срок её действия и CVC/CVV.</li>
            </ol>
            <p>Карта не сохраняется. Автоматические, рекуррентные и скрытые списания не выполняются.</p>
          </PolicySection>

          <PolicySection n="3" title="Когда предоставляется доступ">
            <p>После серверного подтверждения успешного платежа заказ получает статус «оплачен», а аккаунту добавляется выбранный период — 7, 30 или 90 дней. Повторное уведомление по той же операции не выдаёт доступ второй раз.</p>
            <p>Страница настройки профиля становится доступна сразу после активации. Персонализированная выдача начинается после заполнения параметров радара. Telegram и другие каналы подключаются отдельно и не являются условием доступа к веб-интерфейсу.</p>
          </PolicySection>

          <PolicySection n="4" title="Чек самозанятого">
            <p>Продавец применяет НПД. После получения оплаты электронный чек формируется через «Мой налог» или подключённый сервис «Робочеки СМЗ» и направляется по e-mail покупателя.</p>
            <p>Для ООО или ИП в чеке указывается ИНН покупателя. При ошибке реквизитов чек аннулируется и формируется заново; при возврате денег выполняется соответствующая корректировка дохода и чека.</p>
          </PolicySection>

          <PolicySection n="5" title="Как запросить возврат">
            <p>Письмо направляется на <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.docLink}>{OPERATOR_REQUISITES.email}</a>. Укажите e-mail аккаунта, номер заказа, дату, сумму, причину и желаемый объём возврата. Не отправляйте полный номер карты или CVC/CVV.</p>
            <p>Запрос регистрируется по дате получения письма. Решение и, при одобрении, инициирование возврата выполняются не позднее 10 календарных дней, если закон не требует более короткого срока.</p>
          </PolicySection>

          <PolicySection n="6" title="Размер возврата">
            <ul className={s.docList}>
              <li><strong>Полный возврат:</strong> доступ не активирован; сервис не предоставлен по вине продавца; подтверждён повторный или ошибочный платёж; иной случай, когда полный возврат обязателен по закону.</li>
              <li><strong>Частичный возврат:</strong> покупатель добровольно прекращает уже начатый оплаченный период и отсутствует основание для полного возврата.</li>
            </ul>
            <p>При добровольном отказе после активации сумма рассчитывается пропорционально полным неиспользованным календарным дням оплаченного периода. День активации и день получения запроса считаются использованными, если доступ был доступен. Такой расчёт не ограничивает более широкие обязательные права покупателя.</p>
          </PolicySection>

          <PolicySection n="7" title="Проведение и срок зачисления">
            <p>Возврат создаётся через Robokassa на исходный платёжный инструмент, когда это технически возможно. После отправки запроса платёжному оператору фактический срок зачисления определяется банком, платёжной системой и способом оплаты.</p>
            <p>До подтверждения операции Robokassa заявка может иметь статус обработки. Поддержка сообщает идентификатор или результат возврата по запросу покупателя.</p>
          </PolicySection>

          <PolicySection n="8" title="Что происходит с доступом">
            <p>Частичный возврат не прекращает весь доступ автоматически: оставшийся срок определяется согласованным расчётом. После полного подтверждённого возврата период по соответствующему заказу аннулируется.</p>
            <p>Если у пользователя есть другие оплаченные заказы, их периоды сохраняются и выстраиваются последовательно без повторной активации уже возвращённого заказа.</p>
          </PolicySection>

          <PolicySection n="9" title="Ошибочный платёж или заказ не активирован">
            <p>При повторном списании, неверной сумме или отсутствии доступа покупатель обращается в поддержку. Продавец сверяет номер заказа, сумму, подписанное уведомление и серверный статус Robokassa.</p>
            <p>Скриншот, SMS банка или страница успешного возврата браузера помогают найти операцию, но не заменяют серверное подтверждение платежа.</p>
          </PolicySection>

          <PolicySection n="10" title="Связанные документы">
            <p>Полные договорные условия содержатся в <Link href="/terms" className={s.docLink}>публичной оферте</Link>, порядок обработки данных — в <Link href="/privacy" className={s.docLink}>политике обработки персональных данных</Link>, реквизиты продавца — на странице <Link href="/legal" className={s.docLink}>«Реквизиты»</Link>.</p>
          </PolicySection>
        </div>
      </section>
      <SiteFooter />
    </PageFrame>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className={s.docSummaryItem}><span className={s.docSummaryLabel}>{label}</span><span className={s.docSummaryValue}>{value}</span></div>;
}

function PolicySection({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className={s.docClause}>
      <h2 className={s.docClauseTitle}>{n}. {title}</h2>
      <div className={s.docClauseText}>{children}</div>
    </section>
  );
}
