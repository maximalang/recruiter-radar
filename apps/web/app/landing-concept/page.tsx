import type { Metadata } from "next";
import Link from "next/link";

import { BrandLogo } from "../ui/brand-logo";
import styles from "./landing-concept.module.css";

export const metadata: Metadata = {
  title: "Recruiter Radar — концепт лендинга",
  description:
    "Демонстрационная версия нового лендинга Recruiter Radar для рекрутинговых агентств.",
};

const radarCompanies = [
  {
    rank: 1,
    name: "Производственная компания",
    signal: "14 новых вакансий за 6 дней и редкая инженерная роль",
    score: 91,
    tone: "high",
  },
  {
    rank: 2,
    name: "IT-компания",
    signal: "Резко выросло число backend- и data-вакансий",
    score: 86,
    tone: "high",
  },
  {
    rank: 3,
    name: "Финтех-платформа",
    signal: "Расширяет продуктовую и аналитическую команды",
    score: 84,
    tone: "high",
  },
  {
    rank: 4,
    name: "Телеком-оператор",
    signal: "Началось расширение инфраструктурного направления",
    score: 78,
    tone: "medium",
  },
  {
    rank: 5,
    name: "E-commerce-сервис",
    signal: "Увеличился объём найма разработчиков",
    score: 74,
    tone: "medium",
  },
] as const;

const painPoints = [
  {
    number: "01",
    title: "Одни и те же вакансии видят все",
    text: "Когда вакансия появляется на рынке, её одновременно замечают десятки рекрутинговых агентств.",
  },
  {
    number: "02",
    title: "Вакансии не показывают готовность к диалогу",
    text: "Компания может активно нанимать, но не нуждаться во внешнем подборе именно сейчас.",
  },
  {
    number: "03",
    title: "Ручная проверка занимает часы",
    text: "Нужно изучать даты, карьерный сайт, динамику найма, источники и доступные контакты.",
  },
] as const;

const workflow = [
  {
    step: "01",
    title: "Радар обновляет данные",
    text: "Собирает свежие сигналы найма и пересчитывает приоритет компаний под ваш профиль.",
  },
  {
    step: "02",
    title: "Список приходит в Telegram",
    text: "В выбранное время команда получает несколько наиболее подходящих компаний.",
  },
  {
    step: "03",
    title: "Вы проверяете основания",
    text: "В карточке видно, что изменилось, откуда получены данные и почему сигнал актуален.",
  },
  {
    step: "04",
    title: "Выходите с конкретным аргументом",
    text: "Обращаетесь не с общим предложением, а с поводом, связанным с текущей ситуацией компании.",
  },
  {
    step: "05",
    title: "Рекомендации становятся точнее",
    text: "Обратная связь команды учитывается при подготовке следующих списков.",
  },
] as const;

const methodology = [
  ["Источники", "Вакансии, карьерные страницы и открытые корпоративные данные."],
  ["Проверка компании", "Сопоставление названий, сайтов и юридической информации."],
  ["Доказательства", "Источники, даты и изменения активности собираются в одну карточку."],
  ["Оценка", "Соответствие, сила найма, срочность и доступность контакта."],
  ["Уверенность", "Слабые и противоречивые сигналы отсеиваются."],
  ["Рекомендация", "Понятное объяснение, почему стоит написать и что делать дальше."],
] as const;

const faqItems = [
  {
    question: "Чем Recruiter Radar отличается от поиска по hh.ru?",
    answer:
      "Поиск показывает вакансии. Recruiter Radar анализирует активность компании, оценивает её соответствие вашему агентству и объясняет, почему стоит выйти на контакт именно сейчас.",
  },
  {
    question: "Сколько компаний приходит каждый день?",
    answer:
      "Обычно от 3 до 7. Количество зависит от специализации, географии и наличия подтверждённых сигналов. Радар не добавляет слабые компании только ради объёма.",
  },
  {
    question: "Откуда берутся данные?",
    answer:
      "Из открытых вакансий, карьерных страниц и других доступных корпоративных источников. В карточке компании указываются источники, даты и основания рекомендации.",
  },
  {
    question: "Подойдёт ли радар агентству с узкой специализацией?",
    answer:
      "Да. Чем точнее задан профиль, тем строже система оценивает соответствие компаний вашей нише.",
  },
  {
    question: "Можно ли исключить текущих клиентов?",
    answer:
      "Да. Можно добавить текущих клиентов и другие компании, которые не должны попадать в рекомендации.",
  },
  {
    question: "Recruiter Radar автоматически отправляет сообщения компаниям?",
    answer:
      "Нет. Сервис помогает выбрать компанию, проверить основания и подготовить аргументированный выход на контакт. Решение об обращении всегда принимает пользователь.",
  },
] as const;

function DotMeter({ value }: { value: number }) {
  return (
    <span className={styles.dotMeter} aria-label={`${value} из 5`}>
      {[1, 2, 3, 4, 5].map((dot) => (
        <span key={dot} data-active={dot <= value ? "true" : "false"} />
      ))}
    </span>
  );
}

export default function LandingConceptPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="Recruiter Radar — на главную">
            <BrandLogo />
          </Link>
          <nav className={styles.nav} aria-label="Навигация по странице">
            <a href="#how">Как работает</a>
            <a href="#demo">Пример</a>
            <a href="#methodology">Почему Recruiter Radar</a>
            <a href="#pricing">Тарифы</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className={styles.headerActions}>
            <Link href="/dashboard" className={styles.loginLink}>Войти</Link>
            <a href="#demo" className={styles.headerCta}>Найти компании</a>
          </div>
        </div>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroGlow} aria-hidden="true" />
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <div className={styles.eyebrow}>Для рекрутинговых агентств</div>
              <h1>
                Находите компании, которым нужен подбор — <span>до того, как им напишут конкуренты</span>
              </h1>
              <p className={styles.heroText}>
                Recruiter Radar ежедневно анализирует вакансии и карьерные страницы,
                находит подтверждённые сигналы найма и показывает, каким компаниям стоит написать сегодня.
              </p>
              <div className={styles.heroActions}>
                <a href="#demo" className={styles.primaryCta}>Показать компании для вашей ниши</a>
                <a href="#signal" className={styles.secondaryCta}>
                  <span className={styles.playIcon}>▶</span>
                  Посмотреть пример
                </a>
              </div>
              <p className={styles.setupNote}>Настройка занимает 2 минуты</p>
              <div className={styles.trustRow}>
                <span>Данные обновляются каждый день</span>
                <span>Только релевантные рекомендации</span>
              </div>
            </div>

            <div className={styles.heroRadar} aria-label="Демонстрационная карточка радара">
              <div className={styles.radarTopbar}>
                <span>Радар обновлён сегодня</span>
                <span className={styles.liveBadge}><i /> Демо</span>
              </div>
              <div className={styles.primaryLead}>
                <div className={styles.leadHeader}>
                  <div className={styles.leadRank}>1</div>
                  <div className={styles.leadNameWrap}>
                    <strong>Производственная компания</strong>
                    <span>Промышленность · Москва и область</span>
                  </div>
                  <div className={styles.score}><strong>91</strong><span>/100</span></div>
                </div>

                <div className={styles.whyNow}>
                  <span>Почему стоит написать сейчас</span>
                  <ul>
                    <li>14 новых вакансий за последние 6 дней</li>
                    <li>открыта редкая инженерная позиция</li>
                    <li>найм подтверждён карьерной страницей</li>
                  </ul>
                </div>

                <div className={styles.meters}>
                  <div><span>Соответствие</span><DotMeter value={5} /></div>
                  <div><span>Сила найма</span><DotMeter value={4} /></div>
                  <div><span>Актуальность</span><DotMeter value={5} /></div>
                  <div><span>Контакт</span><DotMeter value={4} /></div>
                </div>

                <div className={styles.leadFooter}>
                  <span><small>Рекомендуемый момент</small><strong>Сегодня</strong></span>
                  <span><small>Как связаться</small><strong>Корпоративная HR-форма</strong></span>
                </div>
              </div>

              <div className={styles.compactLead}>
                <span className={styles.compactRank}>2</span>
                <strong>IT-компания</strong>
                <span>Рост backend- и data-вакансий</span>
                <b>86</b>
              </div>
              <div className={styles.compactLead}>
                <span className={styles.compactRank}>3</span>
                <strong>Финтех-платформа</strong>
                <span>Расширение продуктовой команды</span>
                <b>84</b>
              </div>
              <a href="#demo" className={styles.radarLink}>Посмотреть все компании →</a>
            </div>
          </div>
        </section>

        <section className={styles.problemSection}>
          <div className={styles.sectionHeadingRow}>
            <div>
              <div className={styles.sectionEyebrow}>Почему обычного поиска недостаточно</div>
              <h2>Вакансии показывают, кто нанимает. Но не показывают, кому стоит писать сегодня</h2>
            </div>
            <p>
              Recruiter Radar превращает поток вакансий в короткую очередь компаний,
              где потребность подтверждена, а момент для контакта объяснён.
            </p>
          </div>
          <div className={styles.painGrid}>
            {painPoints.map((item) => (
              <article key={item.number} className={styles.painCard}>
                <span>{item.number}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
            <article className={styles.outcomeCard}>
              <div className={styles.outcomeIcon}>✦</div>
              <h3>Несколько приоритетных компаний вместо бесконечного списка</h3>
              <p>Вы сразу видите, что изменилось, почему стоит написать и какой контакт использовать.</p>
            </article>
          </div>
        </section>

        <section id="demo" className={styles.demoSection}>
          <div className={styles.sectionIntroCentered}>
            <div className={styles.sectionEyebrow}>Интерактивный пример</div>
            <h2>Посмотрите, какие компании подходят вашему агентству</h2>
            <p>Укажите специализацию и географию. Радар покажет, как будет выглядеть ваш ежедневный список.</p>
          </div>

          <div className={styles.demoShell}>
            <aside className={styles.profilePanel}>
              <div className={styles.panelHeader}>
                <span className={styles.panelNumber}>01</span>
                <div>
                  <h3>Настройте профиль агентства</h3>
                  <p>Демонстрационные параметры для оценки структуры страницы.</p>
                </div>
              </div>

              <label>
                <span>Специализация</span>
                <select defaultValue="industrial">
                  <option value="industrial">Промышленный подбор</option>
                  <option value="it">IT-подбор</option>
                  <option value="executive">Executive search</option>
                </select>
              </label>
              <label>
                <span>Ключевые роли</span>
                <select defaultValue="engineers">
                  <option value="engineers">Инженеры, руководители производства</option>
                  <option value="developers">Разработчики, аналитики</option>
                  <option value="leaders">Руководители функций</option>
                </select>
              </label>
              <label>
                <span>Отрасли</span>
                <select defaultValue="manufacturing">
                  <option value="manufacturing">Производство, машиностроение</option>
                  <option value="technology">IT, финтех</option>
                  <option value="retail">Ритейл, e-commerce</option>
                </select>
              </label>
              <label>
                <span>География</span>
                <select defaultValue="moscow">
                  <option value="moscow">Москва и Московская область</option>
                  <option value="russia">Вся Россия</option>
                  <option value="remote">Удалённые команды</option>
                </select>
              </label>
              <label>
                <span>Исключить компании</span>
                <input placeholder="Текущие клиенты и исключения" />
              </label>
              <label>
                <span>Компаний в день</span>
                <select defaultValue="5">
                  <option value="3">3 компании</option>
                  <option value="5">5 компаний</option>
                  <option value="7">7 компаний</option>
                </select>
              </label>

              <a href="#demo-results" className={styles.demoButton}>Показать подходящие компании</a>
              <p className={styles.formNote}>Профиль можно изменить после запуска</p>
            </aside>

            <div id="demo-results" className={styles.resultsPanel}>
              <div className={styles.resultsHeader}>
                <div>
                  <span className={styles.panelNumber}>02</span>
                  <h3>Компании для вашего профиля</h3>
                </div>
                <div className={styles.resultStatus}><i /> Найдено 7 компаний</div>
              </div>
              <div className={styles.tableHeader}>
                <span>Компания</span>
                <span>Почему сейчас</span>
                <span>Приоритет</span>
              </div>
              <div className={styles.companyList}>
                {radarCompanies.map((company) => (
                  <article key={company.rank} className={styles.companyRow}>
                    <span className={styles.companyRank}>{company.rank}</span>
                    <div className={styles.companyName}>
                      <strong>{company.name}</strong>
                      <span>Подходит под профиль</span>
                    </div>
                    <p>{company.signal}</p>
                    <div className={styles.companyScore} data-tone={company.tone}>
                      <strong>{company.score}</strong><span>/100</span>
                    </div>
                  </article>
                ))}
              </div>
              <a href="#pricing" className={styles.telegramCta}>
                Получать такой список каждое утро в Telegram
                <span>↗</span>
              </a>
            </div>
          </div>
        </section>

        <section id="how" className={styles.workflowSection}>
          <div className={styles.sectionIntroCentered}>
            <div className={styles.sectionEyebrow}>Ежедневный процесс</div>
            <h2>Готовый список компаний — в удобное для вашей команды время</h2>
            <p>От обновления данных до первого аргументированного контакта — один понятный рабочий цикл.</p>
          </div>
          <div className={styles.workflowGrid}>
            {workflow.map((item) => (
              <article key={item.step} className={styles.workflowCard}>
                <span className={styles.workflowStep}>{item.step}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="signal" className={styles.signalSection}>
          <div className={styles.signalIntro}>
            <div className={styles.sectionEyebrow}>Разбор рекомендации</div>
            <h2>Вы видите не только оценку, но и основания</h2>
            <p>
              Каждая карточка отвечает на четыре вопроса: подходит ли компания,
              есть ли реальная потребность, почему момент актуален и как выйти на контакт.
            </p>
            <a href="#methodology" className={styles.textLink}>Как формируется рекомендация →</a>
          </div>

          <article className={styles.signalCard}>
            <div className={styles.signalCardHeader}>
              <div>
                <a href="#" className={styles.companyWebsite}>Производственная компания ↗</a>
                <span>Промышленность · Москва и область</span>
              </div>
              <div className={styles.largeScore}><strong>91</strong><span>/100</span><small>Высокий приоритет</small></div>
            </div>

            <div className={styles.signalAxes}>
              <div><span>Соответствие</span><DotMeter value={5} /><small>Роли совпадают с профилем</small></div>
              <div><span>Сила найма</span><DotMeter value={4} /><small>Несколько свежих вакансий</small></div>
              <div><span>Срочность</span><DotMeter value={5} /><small>Активность резко выросла</small></div>
              <div><span>Доступность</span><DotMeter value={4} /><small>Есть корпоративный контакт</small></div>
            </div>

            <div className={styles.signalBody}>
              <div className={styles.signalSummary}>
                <span className={styles.cardLabel}>Почему сейчас</span>
                <p>
                  За 6 дней компания открыла 14 вакансий, включая редкую инженерную позицию.
                  Это может указывать на расширение команды и дополнительную нагрузку на внутренний подбор.
                </p>
                <span className={styles.cardLabel}>Рекомендуемый следующий шаг</span>
                <p>Обратиться через корпоративную HR-форму и предложить помощь с инженерным направлением.</p>
                <div className={styles.contactLinks}>
                  <a href="#">HR-форма ↗</a>
                  <a href="#">Карьерная страница ↗</a>
                  <a href="#">Сайт компании ↗</a>
                </div>
              </div>

              <div className={styles.timeline}>
                <span className={styles.cardLabel}>Доказательства</span>
                <div><time>15 июля</time><p>На карьерной странице появились 4 инженерные позиции</p></div>
                <div><time>12 июля</time><p>Количество открытых ролей выросло с 7 до 16</p></div>
                <div><time>10 июля</time><p>Опубликована вакансия руководителя производства</p></div>
                <a href="#">Посмотреть все источники →</a>
              </div>
            </div>
          </article>
        </section>

        <section className={styles.comparisonSection}>
          <div className={styles.sectionIntroCentered}>
            <div className={styles.sectionEyebrow}>Разница в результате</div>
            <h2>Это не ещё одна база вакансий</h2>
          </div>
          <div className={styles.comparisonGrid}>
            <div className={styles.comparisonColumn}>
              <h3>Обычная база или поиск</h3>
              <ul>
                <li>Сотни вакансий без приоритета</li>
                <li>Одинаковые результаты для всех</li>
                <li>Не объясняет готовность компании</li>
                <li>Требует ручной проверки</li>
                <li>Не показывает следующий шаг</li>
              </ul>
            </div>
            <div className={`${styles.comparisonColumn} ${styles.comparisonAccent}`}>
              <h3>Recruiter Radar</h3>
              <ul>
                <li>Несколько приоритетных компаний</li>
                <li>Ранжирование под нишу агентства</li>
                <li>Понятное «почему сейчас»</li>
                <li>Доказательства в одной карточке</li>
                <li>Корректный путь контакта</li>
              </ul>
            </div>
          </div>
        </section>

        <section id="methodology" className={styles.methodologySection}>
          <div className={styles.methodologyHeading}>
            <div className={styles.sectionEyebrow}>Методология и доверие</div>
            <h2>Каждую рекомендацию можно проверить</h2>
            <p>
              Recruiter Radar не создаёт выводы без подтверждений и не превращает слабый сигнал в готовый лид.
            </p>
          </div>
          <div className={styles.methodologyFlow}>
            {methodology.map(([title, text], index) => (
              <article key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
          <div className={styles.evidenceStatement}>
            <span>Evidence-first</span>
            <p>ИИ помогает анализировать данные, но каждый вывод опирается на проверяемые источники.</p>
          </div>
        </section>

        <section id="pricing" className={styles.pricingSection}>
          <div className={styles.sectionIntroCentered}>
            <div className={styles.sectionEyebrow}>Тарифы</div>
            <h2>Проверьте новый канал поиска клиентов за одну неделю</h2>
            <p>Оцените качество компаний на тестовом запуске, прежде чем подключать радар надолго.</p>
          </div>

          <div className={styles.pricingGrid}>
            <article className={`${styles.priceCard} ${styles.priceCardFeatured}`}>
              <div className={styles.priceBadge}>Рекомендуем начать</div>
              <span className={styles.planName}>Тестовый радар</span>
              <p className={styles.planTerm}>7 дней</p>
              <div className={styles.priceRow}>
                <div><del>5 990 ₽</del><strong>2 990 ₽</strong></div>
                <span>скидка 3 000 ₽</span>
              </div>
              <p className={styles.planDescription}>Чтобы проверить качество рекомендаций и встроить радар в работу команды.</p>
              <ul>
                <li>Настройка профиля агентства</li>
                <li>Ежедневный список в Telegram</li>
                <li>Почему стоит написать сейчас</li>
                <li>Источники и доказательства</li>
                <li>Корпоративный путь контакта</li>
              </ul>
              <a href="/checkout" className={styles.pricePrimary}>Запустить радар на 7 дней</a>
            </article>

            <article className={styles.priceCard}>
              <span className={styles.planName}>Месячный радар</span>
              <p className={styles.planTerm}>30 дней</p>
              <div className={styles.priceSimple}>15 990 ₽</div>
              <p className={styles.planDescription}>Для регулярного использования радара как канала поиска новых клиентов.</p>
              <ul>
                <li>Все возможности тестового запуска</li>
                <li>История рекомендаций</li>
                <li>Изменение профиля</li>
                <li>Учёт обратной связи</li>
              </ul>
              <a href="/checkout?plan=monthly" className={styles.priceSecondary}>Подключить на месяц</a>
            </article>

            <article className={styles.priceCard}>
              <span className={styles.planName}>Квартальный радар</span>
              <p className={styles.planTerm}>90 дней</p>
              <div className={styles.priceSimple}>39 090 ₽</div>
              <p className={styles.planSaving}>13 030 ₽ в месяц · экономия 8 880 ₽</p>
              <p className={styles.planDescription}>Для команд, которые встраивают радар в системную работу BD.</p>
              <ul>
                <li>Все возможности месячного тарифа</li>
                <li>Минимальная стоимость месяца</li>
                <li>Поддержка при настройке</li>
                <li>Работа нескольких сотрудников</li>
              </ul>
              <a href="/checkout?plan=quarterly" className={styles.priceSecondary}>Подключить на 3 месяца</a>
            </article>
          </div>

          <div className={styles.pricingTrust}>
            <span>Без автоматического продления</span>
            <span>Без скрытых платежей</span>
            <span>Профиль можно менять</span>
            <span>Помощь при настройке</span>
          </div>
        </section>

        <section id="faq" className={styles.faqSection}>
          <div className={styles.faqHeading}>
            <div className={styles.sectionEyebrow}>FAQ</div>
            <h2>Коротко о главном</h2>
            <p>Ответы на вопросы, которые обычно возникают перед запуском.</p>
          </div>
          <div className={styles.faqList}>
            {faqItems.map((item) => (
              <details key={item.question}>
                <summary>{item.question}<span>+</span></summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={styles.finalCta}>
          <div>
            <div className={styles.sectionEyebrow}>Первый список — уже завтра</div>
            <h2>Узнайте, каким компаниям стоит написать сейчас</h2>
            <p>Настройте профиль агентства и проверьте новый канал поиска клиентов за 7 дней.</p>
          </div>
          <a href="/checkout" className={styles.finalButton}>Показать подходящие компании</a>
        </section>
      </main>

      <footer className={styles.footer}>
        <BrandLogo />
        <p>Evidence-first радар клиентских возможностей для рекрутинговых агентств.</p>
        <div>
          <Link href="/terms">Условия</Link>
          <Link href="/privacy">Конфиденциальность</Link>
        </div>
      </footer>
    </div>
  );
}
