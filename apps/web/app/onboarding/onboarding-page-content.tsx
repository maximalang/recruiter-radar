import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  HIRING_MODE_OPTIONS,
  INDUSTRY_OPTIONS,
  ROLE_OPTIONS,
} from "@/lib/clientProfileOptions";
import {
  loadOnboardingSnapshot,
  ONBOARDING_TEAM_ROLE_OPTIONS,
  readOnboardingContext,
  type OnboardingSnapshot,
} from "@/lib/auth-v2/onboarding";
import { BrandLogo } from "../ui/brand-logo";
import { saveOnboardingAction } from "./actions";
import styles from "./onboarding.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Настройка радара — Recruiter Radar",
  description: "Короткая настройка рабочего профиля Recruiter Radar.",
  robots: { index: false, follow: false },
};

export type OnboardingViewSnapshot = OnboardingSnapshot;

const STEP_LABELS = [
  { key: "agency", number: "01", label: "Команда" },
  { key: "profile", number: "02", label: "Практика" },
  { key: "complete", number: "03", label: "Готово" },
] as const;

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  invalid: "Проверьте заполненные поля и попробуйте ещё раз.",
  request: "Не удалось подтвердить запрос. Обновите страницу и повторите.",
  unavailable: "Не удалось сохранить изменения. Данные не потеряны — попробуйте ещё раз.",
};

function optionLabel(
  options: readonly { key: string; label: string }[],
  key: string | undefined,
): string | null {
  return options.find((option) => option.key === key)?.label ?? null;
}

function ProfileCheckboxes(props: {
  legend: string;
  name: "roles" | "industries";
  options: readonly { key: string; label: string }[];
  selected: readonly string[];
}) {
  return (
    <fieldset className={styles.fieldset}>
      <legend>{props.legend}</legend>
      <div className={styles.choiceGrid}>
        {props.options.map((option) => (
          <label className={styles.choice} key={option.key}>
            <input
              type="checkbox"
              name={props.name}
              value={option.key}
              defaultChecked={props.selected.includes(option.key)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AgencyStep({ snapshot }: { snapshot: OnboardingSnapshot }) {
  return (
    <section className={styles.stepPanel} aria-labelledby="agency-step-title">
      <p className={styles.kicker}>Шаг 1 из 3</p>
      <h2 id="agency-step-title">Сначала — о вашей команде</h2>
      <p className={styles.stepLead}>
        Эти данные помогут подписать рабочее пространство и обращаться к вам
        по имени.
      </p>
      <form action={saveOnboardingAction} className={styles.form}>
        <input type="hidden" name="step" value="agency" />
        <label className={styles.field}>
          <span>Ваше имя</span>
          <input
            name="fullName"
            type="text"
            autoComplete="name"
            maxLength={120}
            defaultValue={snapshot.data.fullName ?? ""}
            required
          />
        </label>
        <label className={styles.field}>
          <span>Название агентства или команды</span>
          <input
            name="agencyName"
            type="text"
            autoComplete="organization"
            maxLength={160}
            defaultValue={snapshot.data.agencyName ?? ""}
            required
          />
        </label>
        <label className={styles.field}>
          <span>Ваша роль</span>
          <select
            name="teamRole"
            defaultValue={snapshot.data.teamRole ?? ""}
            required
          >
            <option value="" disabled>Выберите роль</option>
            {ONBOARDING_TEAM_ROLE_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.primaryRow}>
          <button
            className={styles.primaryAction}
            type="submit"
            name="intent"
            value="next"
          >
            Продолжить
          </button>
        </div>
      </form>
    </section>
  );
}

function ProfileStep({ snapshot }: { snapshot: OnboardingSnapshot }) {
  return (
    <section className={styles.stepPanel} aria-labelledby="profile-step-title">
      <p className={styles.kicker}>Шаг 2 из 3</p>
      <h2 id="profile-step-title">Кого и где вы нанимаете</h2>
      <p className={styles.stepLead}>
        Только основа практики. Тонкие фильтры можно настроить позже в профиле.
      </p>
      <form action={saveOnboardingAction} className={styles.form}>
        <input type="hidden" name="step" value="profile" />
        <label className={styles.field}>
          <span>Специализация</span>
          <input
            name="specialization"
            type="text"
            maxLength={240}
            defaultValue={snapshot.data.specialization ?? ""}
            placeholder="Например, Product, Data и IT"
          />
        </label>
        <ProfileCheckboxes
          legend="Роли"
          name="roles"
          options={ROLE_OPTIONS}
          selected={snapshot.data.roles ?? []}
        />
        <ProfileCheckboxes
          legend="Отрасли"
          name="industries"
          options={INDUSTRY_OPTIONS}
          selected={snapshot.data.industries ?? []}
        />
        <div className={styles.field}>
          <label htmlFor="onboarding-geography">География</label>
          <textarea
            id="onboarding-geography"
            name="geography"
            rows={2}
            maxLength={900}
            defaultValue={snapshot.data.geography?.join(", ") ?? ""}
            placeholder="Москва, Санкт-Петербург, удалённо"
          />
          <small>До 10 регионов, через запятую.</small>
        </div>
        <div className={styles.field}>
          <label htmlFor="onboarding-hiring-mode">Тип подбора</label>
          <select
            id="onboarding-hiring-mode"
            name="hiringMode"
            defaultValue={snapshot.data.hiringMode ?? "auto"}
          >
            {HIRING_MODE_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.actionRow}>
          <button
            className={styles.secondaryAction}
            type="submit"
            name="intent"
            value="back"
          >
            Назад
          </button>
          <button
            className={styles.textAction}
            type="submit"
            name="intent"
            value="skip"
          >
            Пропустить
          </button>
          <button
            className={styles.primaryAction}
            type="submit"
            name="intent"
            value="next"
          >
            Сохранить и продолжить
          </button>
        </div>
      </form>
    </section>
  );
}

function CompleteStep({ snapshot }: { snapshot: OnboardingSnapshot }) {
  const roleNames = (snapshot.data.roles ?? [])
    .map((key) => optionLabel(ROLE_OPTIONS, key))
    .filter((value): value is string => Boolean(value));
  const industryNames = (snapshot.data.industries ?? [])
    .map((key) => optionLabel(INDUSTRY_OPTIONS, key))
    .filter((value): value is string => Boolean(value));
  const hiringMode = optionLabel(
    HIRING_MODE_OPTIONS,
    snapshot.data.hiringMode,
  );

  return (
    <section className={styles.stepPanel} aria-labelledby="complete-step-title">
      <p className={styles.kicker}>Шаг 3 из 3</p>
      <h2 id="complete-step-title">Основа радара готова</h2>
      <p className={styles.stepLead}>
        Профиль создан. Радар готов анализировать рынок после проверки
        настроек, а доставка включается отдельно — по доступному тарифу.
      </p>
      <dl className={styles.summary}>
        <div>
          <dt>Команда</dt>
          <dd>{snapshot.data.agencyName ?? snapshot.workspaceName}</dd>
        </div>
        <div>
          <dt>Специализация</dt>
          <dd>{snapshot.data.specialization || "Уточните позже"}</dd>
        </div>
        <div>
          <dt>Роли</dt>
          <dd>{roleNames.join(", ") || "Без ограничений"}</dd>
        </div>
        <div>
          <dt>Отрасли</dt>
          <dd>{industryNames.join(", ") || "Без ограничений"}</dd>
        </div>
        <div>
          <dt>География</dt>
          <dd>{snapshot.data.geography?.join(", ") || "Без ограничений"}</dd>
        </div>
        <div>
          <dt>Режим</dt>
          <dd>{hiringMode ?? "Авто"}</dd>
        </div>
      </dl>
      <form action={saveOnboardingAction} className={styles.completeActions}>
        <input type="hidden" name="step" value="complete" />
        <button
          className={styles.secondaryAction}
          type="submit"
          name="intent"
          value="back"
        >
          Изменить профиль
        </button>
        <button
          className={styles.primaryAction}
          type="submit"
          name="intent"
          value="finish"
        >
          Перейти в кабинет
        </button>
      </form>
      <p className={styles.deliveryLater}>
        Настроить доставку позже можно в разделе профиля.
      </p>
    </section>
  );
}

export function OnboardingView(props: {
  snapshot: OnboardingSnapshot;
  error?: string;
}) {
  const currentIndex = STEP_LABELS.findIndex(
    (step) => step.key === props.snapshot.step,
  );

  return (
    <main className={styles.shell} data-ui-system="recruiter-radar-v7">
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Recruiter Radar">
          <BrandLogo size="small" tone="dark" />
        </Link>
        <p>Первичная настройка</p>
      </header>
      <div className={styles.layout}>
        <aside className={styles.context}>
          <p className={styles.eyebrow}>Recruiter Radar</p>
          <h1>Настроим радар под вашу практику</h1>
          <p>
            Три коротких шага. Прогресс сохраняется на сервере — можно закрыть
            страницу и продолжить позже.
          </p>
          <ol className={styles.progress} aria-label="Прогресс настройки">
            {STEP_LABELS.map((step, index) => (
              <li
                key={step.key}
                className={index <= currentIndex ? styles.progressActive : ""}
                aria-current={index === currentIndex ? "step" : undefined}
              >
                <span>{step.number}</span>
                <strong>{step.label}</strong>
              </li>
            ))}
          </ol>
          <p className={styles.workspaceNote}>
            Рабочее пространство
            <strong>{props.snapshot.workspaceName}</strong>
          </p>
        </aside>
        <div className={styles.content}>
          {props.error && ERROR_MESSAGES[props.error] ? (
            <p className={styles.error} role="alert">
              {ERROR_MESSAGES[props.error]}
            </p>
          ) : null}
          {props.snapshot.step === "agency" ? (
            <AgencyStep snapshot={props.snapshot} />
          ) : null}
          {props.snapshot.step === "profile" ? (
            <ProfileStep snapshot={props.snapshot} />
          ) : null}
          {props.snapshot.step === "complete" ? (
            <CompleteStep snapshot={props.snapshot} />
          ) : null}
          <p className={styles.privacyNote}>
            Мы сохраняем только данные о вашей рабочей практике. Личные
            телефоны и персональные контакты кандидатов не нужны.
          </p>
        </div>
      </div>
    </main>
  );
}

export default async function OnboardingPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const context = await readOnboardingContext();
  if (!context) redirect("/login?returnTo=/onboarding");

  const snapshot = await loadOnboardingSnapshot(context);
  if (snapshot.status === "completed") {
    redirect("/dashboard");
  }
  const query = await props.searchParams;

  return <OnboardingView snapshot={snapshot} error={query.error} />;
}
