import type { Metadata } from "next";
import Link from "next/link";

import { PageFrame, SectionIntro, SurfaceCard } from "../ui/page-primitives";

export const metadata: Metadata = {
  title: "Политика конфиденциальности — Recruiter Radar",
  description:
    "Политика обработки персональных данных сервиса Recruiter Radar в соответствии с ФЗ-152.",
  robots: { index: true, follow: true },
};

const OPERATOR = {
  fullName: "Головий Наталья Ярославна",
  inn: "622809740837",
  status: "Самозанятый, плательщик НПД (налог на профессиональный доход)",
  email: "6uunn9@gmail.com",
  service: "Recruiter Radar — ежедневный радар по компаниям с активным наймом",
};

export default function PrivacyPage() {
  return (
    <PageFrame maxWidth="820px">
      <section style={{ display: "grid", gap: "18px", padding: "32px 0" }}>
        <SectionIntro
          eyebrow="Документ"
          title="Политика конфиденциальности"
          description="Политика обработки и защиты персональных данных пользователей сервиса Recruiter Radar. Согласием с условиями ниже считается факт использования сервиса или его оплаты."
        />

        <SurfaceCard padding="18px">
          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", color: "var(--c-text-secondary, #475569)", fontSize: "0.92rem" }}>
            <strong style={{ color: "var(--c-text-primary, #0f172a)" }}>Оператор:</strong>
            <span>{OPERATOR.fullName}</span>
            <span style={{ color: "var(--c-text-muted, #94a3b8)" }}>·</span>
            <span>самозанятый, ИНН {OPERATOR.inn}</span>
            <span style={{ color: "var(--c-text-muted, #94a3b8)" }}>·</span>
            <span>действует с 11 июля 2026</span>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="1" title="Общие положения">
            Настоящая Политика определяет порядок обработки и защиты персональных данных
            пользователей сервиса Recruiter Radar (далее — Сервис) оператором — самозанятым
            Головий Натальей Ярославной (далее — Оператор). Политика разработана в соответствии
            с Федеральным законом № 152-ФЗ «О персональных данных». Используя Сервис или
            оплачивая тариф, пользователь даёт согласие на обработку данных, описанную ниже.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="2" title="Какие данные обрабатываются">
            <p>Оператор обрабатывает минимальный объём данных, необходимый для оказания услуг:</p>
            <ul style={{ margin: "8px 0", paddingLeft: "20px", display: "grid", gap: "6px" }}>
              <li><strong>Контактные данные пользователя</strong> — имя (наименование агентства), контакт (e-mail или Telegram-контакт) для связи и доставки дайджеста.</li>
              <li><strong>Параметры профиля поиска</strong> — город, специализация, ключевые слова, география и настройки фильтров, заданные пользователем.</li>
              <li><strong>История обратной связи</strong> — отметки по компаниям (беру / мимо / позже / написал / ответили / созвон / клиент / скрыть похожие) для подавления и перенастройки радара.</li>
              <li><strong>Платёжные атрибуты</strong> — статус и дата оплаты, идентификатор заказа. Полные данные карты не хранятся и не обрабатываются Оператором — оплату проводит ЮKassa.</li>
              <li><strong>Технические данные</strong> — обезличенный идентификатор сессии (cookie), необходимый для работы личного кабинета.</li>
            </ul>
            <p>Данные публичных компаний-работодателей (вакансии, карьерные страницы, контакты) собираются из открытых источников и не являются персональными данными пользователя.</p>
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="3" title="Цели обработки">
            Данные обрабатываются исключительно для оказания услуг Сервиса:
            <ol style={{ margin: "8px 0", paddingLeft: "20px", display: "grid", gap: "6px" }}>
              <li>Формирование и доставка ежедневного радара компаний под профиль пользователя.</li>
              <li>Настройка и калибровка профиля поиска по обратной связи.</li>
              <li>Подавление нерелевантных компаний и перенастройка радара.</li>
              <li>Приём оплаты и формирование чека по ФЗ-54.</li>
              <li>Связь с пользователем по вопросам оказания услуг.</li>
            </ol>
            Оператор не использует данные для иных целей и не передаёт их третьим лицам в рекламных или маркетинговых целях.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="4" title="Правовое основание">
            Основаниями обработки являются: согласие пользователя (факт использования Сервиса
            или оплаты), исполнение договора-оферты и требования законодательства РФ
            (в т.ч. ФЗ-54 о применении контрольно-кассовой техники и налоговое законодательство
            в части самозанятости).
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="5" title="Передача данных третьим лицам">
            <p>Оператор передаёт данные только в объёме, необходимом для оказания услуг:</p>
            <ul style={{ margin: "8px 0", paddingLeft: "20px", display: "grid", gap: "6px" }}>
              <li><strong>ЮKassa</strong> — для приёма оплаты. Полные данные карты обрабатываются на стороне ЮKassa и Оператору недоступны.</li>
              <li><strong>Telegram</strong> — для доставки дайджеста по запросу пользователя (чат-идентификатор).</li>
              <li><strong>Сервисы доставки (e-mail)</strong> — при подключённой e-mail-доставке, по запросу пользователя.</li>
            </ul>
            <p>Оператор не продаёт и не передаёт данные пользователей рекламным, брокерским или иным третьим лицам, кроме случаев, прямо требуемых законом.</p>
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="6" title="Хранение и срок">
            Данные пользователя хранятся в течение срока действия тарифа и после его окончания
            — до отзыва согласия или удаления учётной записи. Платёжные данные (статус, дата,
            идентификатор заказа) хранятся в течение срока, установленного налоговым
            законодательством РФ. При отзыве согласия данные удаляются в течение 30 дней,
            за исключением данных, обязанных к хранению по закону.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="7" title="Права пользователя">
            Пользователь вправе: получать информацию об обработке своих данных; требовать
            уточнения, блокирования или уничтожения данных; отозвать согласие, направив
            обращение на контактный e-mail Оператора. Отзыв согласия не распространяется на
            обработку, необходимую для исполнения уже оплаченного тарифа и исполнения
            требований закона.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="8" title="Защита данных">
            Оператор принимает технические и организационные меры для защиты данных:
            подписанные сессионные cookies, ограничение доступа к данным оператора,
            хранение данных на серверах с контролем доступа. Данные передаются по HTTPS.
            Оператор не хранит полные данные банковских карт.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="9" title="Cookies">
            Сервис использует подписанную сессионную cookie для работы личного кабинета.
            Cookie не содержит персональных данных в открытом виде и не передаётся третьим
            лицам. Пользователь может отключить cookies в настройках браузера, однако это
            может ограничить работу личного кабинета.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard>
          <TermsSection n="10" title="Обращения и контакт">
            По всем вопросам обработки персональных данных пользователь может обратиться
            на e-mail Оператора:{" "}
            <a href={`mailto:${OPERATOR.email}`} style={{ color: "inherit" }}>{OPERATOR.email}</a>.
            Оператор рассматривает обращения в срок до 30 дней.
          </TermsSection>
        </SurfaceCard>

        <SurfaceCard padding="18px">
          <div style={{ fontSize: "0.9em", color: "var(--c-text-secondary, #475569)" }}>
            <Link href="/" style={{ color: "inherit", textDecoration: "underline" }}>← На главную Recruiter Radar</Link>
            <span style={{ margin: "0 8px" }}>·</span>
            <Link href="/terms" style={{ color: "inherit", textDecoration: "underline" }}>Оферта</Link>
            <span style={{ margin: "0 8px" }}>·</span>
            <Link href="/legal" style={{ color: "inherit", textDecoration: "underline" }}>Реквизиты</Link>
          </div>
        </SurfaceCard>
      </section>
    </PageFrame>
  );
}

function TermsSection({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>
        {n}. {title}
      </h2>
      <div style={{ color: "var(--c-text-secondary, #475569)", lineHeight: 1.65, fontSize: "0.95rem" }}>
        {children}
      </div>
    </div>
  );
}
