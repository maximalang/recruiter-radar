import type { Metadata } from "next";
import Link from "next/link";

import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";
import { PageFrame, SectionIntro } from "../ui/page-primitives";
import { SiteFooter } from "../ui/site-footer";
import s from "../ui/legal-document.module.css";

export const metadata: Metadata = {
  title: "Оплата, получение доступа и возврат — Recruiter Radar",
  description:
    "Порядок оформления заказа, оплаты через ЮKassa, предоставления цифровой услуги, выдачи чека НПД и возврата средств.",
  robots: { index: true, follow: true },
};

const OPERATOR = OPERATOR_REQUISITES;
const REVISION_DATE = "31 июля 2026 года";

export default function PaymentAndDeliveryPage() {
  return (
    <PageFrame maxWidth="760px">
      <section className={s.docSection}>
        <SectionIntro
          eyebrow="Покупателям"
          title="Оплата, получение доступа и возврат"
          description="Прозрачный порядок покупки цифровой информационно-аналитической услуги Recruiter Radar."
        />

        <p className={s.docOperator}>
          Продавец и оператор: <strong>{OPERATOR.fullName}</strong>, самозанятый, ИНН {OPERATOR.inn}.{" "}
          <Link href="/legal" className={s.docLink}>Полные реквизиты</Link>. Редакция от {REVISION_DATE}.
        </p>

        <div className={s.docBody}>
          <InfoSection n="1" title="Что можно приобрести">
            <p>Recruiter Radar предоставляет цифровой доступ к подборкам компаний с подтверждёнными признаками активного найма, источниками сигнала, оценкой уверенности и подсказкой безопасного первого контакта.</p>
            <ul className={s.docList}>
              <li><strong>Неделя</strong> — 2 990 ₽, доступ на 7 календарных дней, разовая онлайн-оплата.</li>
              <li><strong>Месяц</strong> — 14 990 ₽, доступ на 30 календарных дней, подключение по заявке.</li>
              <li><strong>Три месяца</strong> — 29 990 ₽, доступ на 90 календарных дней, подключение по заявке.</li>
            </ul>
            <p>На сайте нет автоматического продления и скрытых рекуррентных списаний. Перед оплатой покупатель видит название тарифа, срок и итоговую сумму.</p>
          </InfoSection>

          <InfoSection n="2" title="Как оформить заказ">
            <ol className={s.docList}>
              <li>Выберите тариф и задайте параметры радара.</li>
              <li>Войдите по рабочему e-mail или создайте аккаунт.</li>
              <li>Проверьте тариф, срок, стоимость и контакт для документов.</li>
              <li>Примите публичную оферту и ознакомьтесь с политикой обработки персональных данных.</li>
              <li>Нажмите «Перейти к оплате» и завершите платёж на защищённой странице ЮKassa.</li>
            </ol>
          </InfoSection>

          <InfoSection n="3" title="Как проходит оплата">
            <p>Платёж обрабатывает ЮKassa. Доступные конкретному покупателю способы оплаты показываются на странице ЮKassa. Recruiter Radar не получает и не хранит полный номер банковской карты, CVC/CVV и иные платёжные реквизиты.</p>
            <p>После завершения оплаты ЮKassa возвращает покупателя на Recruiter Radar. Сервис дополнительно сверяет статус платежа с API ЮKassa и активирует заказ только после подтверждённого статуса успешной оплаты.</p>
          </InfoSection>

          <InfoSection n="4" title="Как предоставляется услуга">
            <p>Услуга предоставляется полностью онлайн; физической доставки нет. После успешной оплаты покупатель получает доступ к настройке профиля в личном кабинете. Результаты доступны в веб-интерфейсе и в подключённых покупателем каналах доставки, включая Telegram.</p>
            <p>Если запуск требует ручной проверки профиля, первый рабочий радар предоставляется не позднее одного рабочего дня после получения всех необходимых параметров. Задержка по вине оператора не сокращает оплаченный период доступа.</p>
          </InfoSection>

          <InfoSection n="5" title="Электронный чек">
            <p>Оператор применяет налог на профессиональный доход. После подтверждения оплаты оператор формирует чек в приложении «Мой налог» либо через разрешённого оператора НПД и направляет его покупателю в электронной форме на контакт, указанный при оформлении.</p>
          </InfoSection>

          <InfoSection n="6" title="Отмена заказа и возврат">
            <p>До завершения оплаты заказ можно отменить без списания средств. Для возврата уже оплаченного заказа напишите на <a href={`mailto:${OPERATOR.email}`} className={s.docLink}>{OPERATOR.email}</a> и укажите e-mail аккаунта, дату и сумму оплаты, название тарифа и причину обращения.</p>
            <p>Если доступ не был предоставлен по вине оператора, платёж возвращается полностью. После начала оказания услуги сумма возврата определяется с учётом фактически предоставленного периода и понесённых расходов в соответствии с публичной офертой и применимым законодательством.</p>
            <p>Согласованный возврат создаётся через ЮKassa на то же платёжное средство, которым был оплачен заказ. Фактический срок зачисления зависит от банка и способа оплаты.</p>
          </InfoSection>

          <InfoSection n="7" title="Контакты по оплате">
            <p>E-mail поддержки: <a href={`mailto:${OPERATOR.email}`} className={s.docLink}>{OPERATOR.email}</a>.</p>
            {OPERATOR.phone ? <p>Телефон: <a href={`tel:${OPERATOR.phone.replace(/[^+\d]/g, "")}`} className={s.docLink}>{OPERATOR.phone}</a>.</p> : null}
            {OPERATOR.postalAddress ? <p>Адрес для корреспонденции: {OPERATOR.postalAddress}.</p> : null}
            <p>Юридические условия приведены в <Link href="/terms" className={s.docLink}>публичной оферте</Link>, сведения об операторе — на странице <Link href="/legal" className={s.docLink}>реквизитов</Link>.</p>
          </InfoSection>
        </div>
      </section>
      <SiteFooter />
    </PageFrame>
  );
}

function InfoSection(props: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2>{props.n}. {props.title}</h2>
      {props.children}
    </section>
  );
}
