import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactElement, SVGProps } from "react";

import { FormSubmitButton } from "../../../ui/form-submit-button";
import {
  PageFrame,
  SectionIntro,
  StatusBadge,
  SurfaceCard,
  SummaryRow,
  ThreeQuestionPanel,
  NoticeBox,
} from "../../../ui/page-primitives";
import {
  IndustryIcon,
  ChatIcon,
  TargetIcon,
  CheckIcon,
} from "../../../ui/icons";
import ppStyles from "../../../ui/page-primitives.module.css";
import {
  formatKeywordText,
  getClientProfileById
} from "../../../../lib/clientProfiles";
import {
  INDUSTRY_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  ROLE_OPTIONS
} from "../../../../lib/clientProfileOptions";
import { getHhDigestItems } from "../../../../lib/hhDigest";
import { getClientProfileWebPushStatuses } from "../../../../lib/webPushSubscriptions";
import {
  ensurePilotOrderOnboardingReady,
  getPilotActivationReadiness,
  type CheckoutOrder,
  type CheckoutOrderOnboardingStep
} from "../../../../lib/payments";
import { getTelegramBotToken } from "../../../../lib/telegram";
import { getTelegramConnectLinkState } from "../../../../lib/telegramConnect";
import { getWebPushConnectLinkState } from "../../../../lib/webPushConnect";
import { readOwnerSession } from "../../../../lib/session";
import {
  completePilotOnboardingAction,
  confirmPilotProfileAction,
  sendPilotTestDigestAction
} from "./actions";
import { BrowserPushCard } from "./browser-push-card";
import { TelegramStepAutoRefresh } from "./telegram-step-auto-refresh";
import {
  InstructionCard,
  UnpaidState,
  formatCompanyCount,
  formatDateTime,
  formatVacanciesCount,
  formatPreviewScore,
  translateOrderStatus,
  getCurrentStep,
  getRequestedStep,
  getSearchParamValue,
  isStepComplete
} from "./pilot-onboarding-components";
import styles from "./pilot-onboarding-components.module.css";

export const dynamic = "force-dynamic";

type PilotOnboardingPageProps = {
  params: Promise<{
    orderId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type StepIcon = (p: SVGProps<SVGSVGElement>) => ReactElement;

const stepItems: Array<{
  key: CheckoutOrderOnboardingStep;
  label: string;
  number: string;
  icon: StepIcon;
}> = [
  { key: "confirm-profile", label: "Профиль", number: "01", icon: IndustryIcon },
  { key: "telegram", label: "Telegram", number: "02", icon: ChatIcon },
  { key: "preview", label: "Радар", number: "03", icon: TargetIcon },
  { key: "complete", label: "Готово", number: "04", icon: CheckIcon },
] as const;

const VISIBLE_PREVIEW_ITEMS = 2;

type OnboardingPreviewItem = Awaited<ReturnType<typeof getHhDigestItems>>[number];

export default async function PilotOnboardingPage({
  params,
  searchParams
}: PilotOnboardingPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const errorMessage = getSearchParamValue(resolvedSearchParams, "error");
  const notice = getSearchParamValue(resolvedSearchParams, "notice");
  const ownerId = await readOwnerSession();

  if (!ownerId) {
    notFound();
  }

  const order = await ensurePilotOrderOnboardingReady(resolvedParams.orderId, { ownerId });

  if (!order) {
    notFound();
  }

  const profile = order.payload.clientProfileId
    ? await getClientProfileById(order.payload.clientProfileId, ownerId).catch(() => null)
    : null;
  const readiness = await getPilotActivationReadiness(order.id, { ownerId });
  const normalizedTelegramBotToken = getTelegramBotToken().botToken?.trim() ?? "";
  const deliveryPrerequisitesReady = Boolean(profile?.telegramChatId) && normalizedTelegramBotToken.length > 0;
  const currentStep = getCurrentStep(order, getRequestedStep(resolvedSearchParams, order));
  const isPushEntry = getSearchParamValue(resolvedSearchParams, "entry") === "push";
  const requestedView = getSearchParamValue(resolvedSearchParams, "view");
  const showPushRadarView = currentStep === "complete" && isPushEntry && (requestedView === null || requestedView === "radar");
  const telegramConnectState =
    order.status === "paid" && profile
      ? await getTelegramConnectLinkState({
          orderId: order.id,
          clientProfileId: profile.id,
          connectedTelegramChatId: profile.telegramChatId
        })
      : null;
  const webPushStatus =
    order.status === "paid" && profile
      ? (
          await getClientProfileWebPushStatuses({
            clientProfileIds: [profile.id]
          })
        ).get(profile.id) ?? null
      : null;
  const webPushConnectState =
    order.status === "paid" && profile
      ? getWebPushConnectLinkState({
          orderId: order.id,
          clientProfileId: profile.id
        })
      : null;
  let previewItems: Awaited<ReturnType<typeof getHhDigestItems>> = [];
  let previewError: string | null = null;

  if (profile && (currentStep === "preview" || currentStep === "complete")) {
    try {
      previewItems = await getHhDigestItems({ clientProfileId: profile.id });
    } catch (error) {
      previewError = error instanceof Error ? error.message : "Не удалось загрузить подборку.";
    }
  }

  const hasTestDigestSent = Boolean(order.payload.onboardingTestDigestSentAt);
  const firstDigestHasCandidates = previewItems.length > 0;
  const firstDigestReady = hasTestDigestSent || (deliveryPrerequisitesReady && firstDigestHasCandidates);
  const confirmPilotProfileBoundAction = confirmPilotProfileAction.bind(null, order.id);
  const sendPilotTestDigestBoundAction = sendPilotTestDigestAction.bind(null, order.id);
  const completePilotOnboardingBoundAction = completePilotOnboardingAction.bind(null, order.id);
  const visiblePreviewItems = previewItems.slice(0, VISIBLE_PREVIEW_ITEMS);
  const hiddenPreviewItems = previewItems.slice(VISIBLE_PREVIEW_ITEMS);
  const telegramDeliveryLabel = telegramConnectState?.botUsername
    ? `подключён через @${telegramConnectState.botUsername}`
    : profile?.telegramChatId
      ? "подключён"
      : "не подключён";
  const browserDeliveryLabel =
    webPushStatus?.configured === true
      ? webPushStatus.activeSubscriptionCount > 0
        ? "подключён"
        : "не подключён"
      : "готовим";
  const previewUnavailableMessage = "Не удалось обновить текущий радар. Попробуйте позже.";
  const stepFocus = buildOnboardingStepFocus({
    currentStep,
    previewCount: previewItems.length,
    hasTestDigestSent,
    telegramConnected: Boolean(profile?.telegramChatId),
    hasPushRadarView: showPushRadarView
  });

  return (
    <PageFrame maxWidth="860px">
      <Link href="/" className={ppStyles.backLink}>
        На главную
      </Link>

      <SurfaceCard style={{ display: "grid", gap: "20px" }}>
        <div style={{ display: "grid", gap: "16px" }}>
          <StatusBadge tone="success">Запуск пилота</StatusBadge>

          <SectionIntro
            title="Закончите настройку"
            description="Сначала профиль, потом Telegram, потом первый радар. Без лишних шагов."
          />

          <ThreeQuestionPanel
            whatLabel="Что важно сейчас"
            whatValue={stepFocus.what}
            whyValue={stepFocus.why}
            nextValue={stepFocus.next}
          />

          <div style={{ display: "grid", gap: "8px" }}>
            <SummaryRow label="Профиль клиента создан" value={readiness?.profileExists ? "да" : "нет"} />
            <SummaryRow
              label="Telegram подключён"
              value={readiness?.telegramConnected ? "да" : "нет"}
            />
            <SummaryRow
              label="Первая подборка готова"
              value={
                hasTestDigestSent
                  ? "отправлен"
                  : firstDigestReady
                    ? "готово"
                    : readiness?.canRequestFirstDigest
                      ? "собираем"
                      : "ждёт предыдущие шаги"
              }
            />
          </div>

          {errorMessage ? (
            <NoticeBox tone="danger" title="Не получилось открыть следующий шаг" description={errorMessage} />
          ) : null}

          {notice === "empty-digest" ? (
            <NoticeBox
              tone="info"
              title="Первая подборка пока не собирается"
              description="По текущему профилю пока нет компаний с достаточно сильным сигналом."
            />
          ) : null}

          <details className={ppStyles.disclosure}>
            <summary className={ppStyles.disclosureSummary}>Детали запуска</summary>
            <div className={ppStyles.disclosureBody}>
              <div className={ppStyles.summaryBox}>
                <SummaryRow label="Тариф" value={order.payload.planName} />
                <SummaryRow label="Оплата" value={translateOrderStatus(order.status)} />
                <SummaryRow label="Контакт" value={order.customerContact ?? "не указан"} />
                <SummaryRow
                  label="Профиль"
                  value={
                    profile
                      ? profile.agencyName
                      : order.status === "paid"
                        ? "создаём"
                        : "станет доступен после оплаты"
                  }
                />
              </div>
            </div>
          </details>
        </div>

        {order.status !== "paid" ? (
          <UnpaidState order={order} />
        ) : (
          <>
            <div className={styles.stepRail}>
              {stepItems.map((step) => {
                const isCurrent = step.key === currentStep;
                const isComplete = isStepComplete(step.key, currentStep);
                // Completed steps carry the CheckIcon (the unified "done" glyph)
                // instead of the step's own glyph, so progress reads at a glance.
                // The current step keeps its semantic glyph; future steps show it
                // muted via the data-future attribute.
                const Glyph = isComplete ? CheckIcon : step.icon;
                return (
                  <div
                    key={step.key}
                    className={styles.stepPill}
                    data-current={isCurrent}
                    data-complete={isComplete}
                    data-future={!isCurrent && !isComplete ? true : undefined}
                  >
                    <Glyph className={styles.stepIcon} aria-hidden="true" />
                    <span className={styles.stepNumber}>{step.number}</span>
                    <span>{step.label}</span>
                  </div>
                );
              })}
            </div>

            {currentStep === "confirm-profile" ? (
              <section className={styles.wizardSection}>
                <SectionIntro
                  eyebrow="Шаг 1"
                  title="Проверьте профиль поиска"
                  description="Оставьте только то, что реально меняет подборку."
                />

                <form action={confirmPilotProfileBoundAction} className={styles.form}>
                  <input type="hidden" name="orderId" value={order.id} />

                  <label className={ppStyles.field}>
                    <span className={ppStyles.fieldLabel}>Название профиля</span>
                    <input
                      name="agencyName"
                      required
                      defaultValue={profile?.agencyName ?? order.customerName ?? "Клиент Recruiter Radar"}
                      placeholder="Название профиля"
                      className={ppStyles.input}
                    />
                  </label>

                  <details className={ppStyles.disclosure} style={{ gridColumn: "1 / -1" }}>
                    <summary className={ppStyles.disclosureSummary}>Уточнить профиль</summary>
                    <div className={ppStyles.disclosureBody}>
                      <label className={ppStyles.field}>
                        <span className={ppStyles.fieldLabel}>Компаний в день</span>
                        <input
                          name="dailyDigestLimit"
                          type="number"
                          min={1}
                          max={10}
                          defaultValue={profile?.dailyDigestLimit ?? order.payload.dailyDigestLimit}
                          className={ppStyles.input}
                        />
                        <span className={ppStyles.helperText}>От 1 до 10 компаний в одной подборке.</span>
                      </label>

                      <label className={ppStyles.field}>
                        <span className={ppStyles.fieldLabel}>Где искать (необязательно)</span>
                        <input
                          name="targetCity"
                          defaultValue={profile?.targetCity ?? order.payload.city ?? ""}
                          placeholder="Москва / Берлин / удалённо"
                          className={ppStyles.input}
                        />
                      </label>

                      <label className={ppStyles.field}>
                        <span className={ppStyles.fieldLabel}>Что искать (необязательно)</span>
                        <input
                          name="specialization"
                          defaultValue={profile?.specialization ?? order.payload.specialization ?? ""}
                          placeholder="Промышленный подбор / финансы C-level / массовый найм"
                          className={ppStyles.input}
                        />
                      </label>

                      <fieldset className={ppStyles.field} style={{ border: "none", padding: 0 }}>
                        <legend className={ppStyles.fieldLabel}>Роли, которые вы закрываете</legend>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {ROLE_OPTIONS.map((role) => (
                            <label key={role.key} style={{ display: "flex", gap: "4px", alignItems: "center", fontSize: "0.88rem", cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                name="roles"
                                value={role.key}
                                defaultChecked={(profile?.roles ?? []).includes(role.key)}
                              />
                              {role.label}
                            </label>
                          ))}
                        </div>
                        <span className={ppStyles.helperText}>Выберите роли, которые ваше агентство закрывает лучше всего. Это влияет на Fit-скоринг.</span>
                      </fieldset>

                      <fieldset className={ppStyles.field} style={{ border: "none", padding: 0 }}>
                        <legend className={ppStyles.fieldLabel}>Отрасли компаний</legend>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {INDUSTRY_OPTIONS.map((industry) => (
                            <label key={industry.key} style={{ display: "flex", gap: "4px", alignItems: "center", fontSize: "0.88rem", cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                name="industries"
                                value={industry.key}
                                defaultChecked={(profile?.industries ?? order.payload.industries ?? []).includes(industry.key)}
                              />
                              {industry.label}
                            </label>
                          ))}
                        </div>
                        <span className={ppStyles.helperText}>Выберите отрасли, в которых вы ищете клиентов.</span>
                      </fieldset>

                      <fieldset className={ppStyles.field} style={{ border: "none", padding: 0 }}>
                        <legend className={ppStyles.fieldLabel}>Исключить отрасли</legend>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {INDUSTRY_OPTIONS.map((industry) => (
                            <label key={industry.key} style={{ display: "flex", gap: "4px", alignItems: "center", fontSize: "0.88rem", cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                name="excludedIndustries"
                                value={industry.key}
                                defaultChecked={(profile?.excludedIndustries ?? []).includes(industry.key)}
                              />
                              {industry.label}
                            </label>
                          ))}
                        </div>
                        <span className={ppStyles.helperText}>Отрасли, с которыми вы точно не работаете.</span>
                      </fieldset>

                      <fieldset className={ppStyles.field} style={{ border: "none", padding: 0 }}>
                        <legend className={ppStyles.fieldLabel}>Размер компаний</legend>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {COMPANY_SIZE_OPTIONS.map((size) => (
                            <label key={size.key} style={{ display: "flex", gap: "4px", alignItems: "center", fontSize: "0.88rem", cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                name="companySizes"
                                value={size.key}
                                defaultChecked={(profile?.companySizes ?? order.payload.companySizes ?? []).includes(size.key)}
                              />
                              {size.label}
                            </label>
                          ))}
                        </div>
                        <span className={ppStyles.helperText}>Выберите размеры компаний, с которыми хотите работать.</span>
                      </fieldset>

                      <label className={ppStyles.field} style={{ gridColumn: "1 / -1" }}>
                        <span className={ppStyles.fieldLabel}>Что важно (необязательно)</span>
                        <textarea
                          name="includeKeywords"
                          rows={4}
                          defaultValue={formatKeywordText(profile?.includeKeywords ?? order.payload.includeKeywords)}
                          placeholder={"рекрутер\nсорсинг\nагентство"}
                          className={ppStyles.textarea}
                        />
                        <span className={ppStyles.helperText}>По одной фразе на строку.</span>
                      </label>

                      <label className={ppStyles.field} style={{ gridColumn: "1 / -1" }}>
                        <span className={ppStyles.fieldLabel}>Что исключить (необязательно)</span>
                        <textarea
                          name="excludeKeywords"
                          rows={4}
                          defaultValue={formatKeywordText(profile?.excludeKeywords ?? order.payload.excludeKeywords)}
                          placeholder={"вахта\nзавод\nстажировка"}
                          className={ppStyles.textarea}
                        />
                        <span className={ppStyles.helperText}>По одной фразе на строку.</span>
                      </label>

                      <label className={ppStyles.field} style={{ gridColumn: "1 / -1" }}>
                        <span className={ppStyles.fieldLabel}>Исключить регионы (необязательно)</span>
                        <textarea
                          name="excludedLocations"
                          rows={3}
                          defaultValue={formatKeywordText(profile?.excludedLocations)}
                          placeholder={"Владивосток\nКазань"}
                          className={ppStyles.textarea}
                        />
                        <span className={ppStyles.helperText}>По одному региону на строку. Компании из этих регионов не появятся в радаре.</span>
                      </label>

                      <label className={ppStyles.field} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <input
                          type="checkbox"
                          name="remoteFriendly"
                          defaultChecked={profile?.remoteFriendly ?? false}
                        />
                        <span style={{ fontSize: "0.88rem" }}>Работаем с удалёнными командами</span>
                      </label>
                    </div>
                  </details>

                  <label className={ppStyles.field} style={{ gridColumn: "1 / -1" }}>
                    <span className={ppStyles.fieldLabel}>Политика контактов</span>
                    <select
                      name="contactPolicy"
                      defaultValue={profile?.contactPolicy ?? "corporate_only"}
                      className={ppStyles.input}
                    >
                      <option value="corporate_only">Только корпоративные каналы (рекомендуется)</option>
                      <option value="no_personal">Без персональных данных</option>
                      <option value="unrestricted">Все каналы</option>
                    </select>
                    <span className={ppStyles.helperText}>
                      Какие контактные данные включать в радар. По умолчанию — только безопасные корпоративные каналы: карьерная страница, HR-email, форма обратной связи.
                    </span>
                  </label>

                  <div className={styles.submitRow}>
                    <FormSubmitButton
                      idleLabel="Сохранить и продолжить"
                      pendingLabel="Сохраняем..."
                      className={ppStyles.primaryAction}
                    />
                    <div className={ppStyles.helperText}>
                      Дальше подключим Telegram.
                    </div>
                  </div>
                </form>
              </section>
            ) : null}

            {currentStep === "telegram" ? (
              <section className={styles.wizardSection}>
                <TelegramStepAutoRefresh orderId={String(order.id)} />

                <SectionIntro
                  eyebrow="Шаг 2"
                  title="Подключите Telegram"
                  description="Откройте бота, нажмите Start и вернитесь сюда. Связка появится сама."
                />

                {telegramConnectState?.error ? (
                  <NoticeBox tone="danger" title="Не удалось подключить Telegram" description={telegramConnectState.error} />
                ) : null}

                {telegramConnectState?.connected ? (
                  <NoticeBox
                    tone="success"
                    title="Telegram подключён"
                    description={
                      telegramConnectState.botUsername
                        ? `Чат уже связан с @${telegramConnectState.botUsername}. Можно идти дальше.`
                        : "Telegram уже подключён. Можно идти дальше."
                    }
                  />
                ) : (
                  <>
                    <div className={styles.instructionGrid}>
                      <InstructionCard step={1}>
                        Откройте {telegramConnectState?.botUsername ? `@${telegramConnectState.botUsername}` : "бот Recruiter Radar"}.
                      </InstructionCard>
                      <InstructionCard step={2}>Нажмите Start в чате.</InstructionCard>
                      <InstructionCard step={3}>Вернитесь сюда. Подключение подтянется само.</InstructionCard>
                    </div>

                    {telegramConnectState?.connectUrl ? (
                      <div style={{ display: "grid", gap: "10px" }}>
                        <div className={styles.actions}>
                          <a
                            href={telegramConnectState.connectUrl}
                            className={ppStyles.primaryAction}
                            style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
                          >
                            <ChatIcon aria-hidden="true" /> Открыть Telegram
                          </a>
                        </div>
                        <div className={ppStyles.helperText}>
                          Если ссылка устареет, просто обновите страницу.
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </section>
            ) : null}

            {currentStep === "preview" ? (
              <section className={styles.wizardSection}>
                <SectionIntro
                  eyebrow="Шаг 3"
                  title="Посмотрите первый радар"
                  description="Проверьте компании, которым стоит написать сегодня: с доказательствами и объяснением почему сейчас."
                />

                <NoticeBox
                  tone="success"
                  title="Чат готов"
                  description={
                    telegramConnectState?.botUsername
                      ? `Первую подборку отправим в чат через @${telegramConnectState.botUsername}.`
                      : "Подключённый чат готов для первой отправки."
                  }
                />

                {previewError ? (
                  <NoticeBox tone="danger" title="Не удалось собрать подборку" description={previewError} />
                ) : previewItems.length === 0 ? (
                  <>
                    <NoticeBox
                      tone="neutral"
                      title="Радар пока спокоен"
                      description="По текущему профилю пока нет компаний с сильным сигналом. Можно уточнить профиль или закончить настройку и вернуться позже."
                    />

                    <div className={styles.actions}>
                      <Link
                        href={`/onboarding/pilot/${order.id}?step=confirm-profile`}
                        className={ppStyles.primaryAction}
                      >
                        Вернуться к профилю
                      </Link>
                      <form action={completePilotOnboardingBoundAction} style={{ margin: 0 }}>
                        <input type="hidden" name="orderId" value={order.id} />
                        <FormSubmitButton
                          idleLabel="Закончить и вернуться позже"
                          pendingLabel="Завершаем..."
                          className={ppStyles.mutedAction}
                        />
                      </form>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "grid", gap: "10px" }}>
                      <form action={sendPilotTestDigestBoundAction} style={{ margin: 0 }}>
                        <input type="hidden" name="orderId" value={order.id} />
                        <FormSubmitButton
                          idleLabel="Отправить первый радар"
                          pendingLabel="Отправляем в Telegram..."
                          className={ppStyles.primaryAction}
                        />
                      </form>
                      <div className={ppStyles.helperText}>
                        Это тестовый запуск. Дальше ежедневный радар будет приходить автоматически при активном пилоте.
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: "12px" }}>
                      {visiblePreviewItems.map((item) => (
                        <OnboardingPreviewCard key={`${item.org_id}-${item.rank}`} item={item} />
                      ))}

                      {hiddenPreviewItems.length > 0 ? (
                        <details className={ppStyles.disclosure}>
                          <summary className={ppStyles.disclosureSummary}>
                            Остальные компании: ещё {hiddenPreviewItems.length}
                          </summary>
                          <div className={ppStyles.disclosureBody}>
                            <div style={{ display: "grid", gap: "12px" }}>
                              {hiddenPreviewItems.map((item) => (
                                <OnboardingPreviewCard key={`${item.org_id}-${item.rank}`} item={item} />
                              ))}
                            </div>
                          </div>
                        </details>
                      ) : null}
                    </div>
                  </>
                )}
              </section>
            ) : null}

            {currentStep === "complete" ? (
              <section className={styles.wizardSection}>
                <div style={{ display: "grid", gap: "10px" }}>
                  <StatusBadge tone="success">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                      <CheckIcon aria-hidden="true" />
                      {hasTestDigestSent ? "Первый радар отправлен" : "Пилот включён"}
                    </span>
                  </StatusBadge>
                  <SectionIntro
                    title={hasTestDigestSent ? "Пилот запущен" : "Всё готово"}
                    description={
                      hasTestDigestSent
                        ? "Первый радар уже в чате. Дальше новые компании будут приходить автоматически."
                        : "Профиль и Telegram готовы. Новые компании будут приходить автоматически."
                    }
                  />
                </div>

                <NoticeBox
                  tone="neutral"
                  title="Как это будет работать дальше"
                  description={
                    hasTestDigestSent
                      ? telegramConnectState?.botUsername
                        ? `Следующие радары будут приходить в тот же чат через @${telegramConnectState.botUsername}.`
                        : "Следующие радары будут приходить в тот же подключённый чат."
                      : "Пилот уже активен. Как только появятся подходящие компании, они будут приходить автоматически."
                  }
                />

                <NoticeBox
                  tone="info"
                  title="Что делать дальше"
                  description={
                    hasTestDigestSent
                      ? "Откройте отправленный радар в Telegram, отмечайте релевантность карточек и используйте обратную связь."
                      : previewError
                        ? "Не удалось обновить текущий радар. Попробуйте позже."
                        : !deliveryPrerequisitesReady
                          ? "Вернитесь к шагу подключения Telegram, чтобы включить доставку радара."
                          : firstDigestHasCandidates
                            ? "Откройте первую подборку в Telegram, отметьте релевантность карточек и используйте обратную связь."
                            : "Пилот уже активен. Как только появятся компании с сильным сигналом, подборка придёт автоматически."
                  }
                />

                {showPushRadarView ? (
                  previewItems.length > 0 ? (
                    <div style={{ display: "grid", gap: "16px" }}>
                      <NoticeBox
                        tone="info"
                        title="Сегодня в радаре есть что посмотреть"
                        description="Сверху собраны компании, которые сильнее всего прямо сейчас. Начните с первых карточек."
                      />

                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <span className={ppStyles.chip}>{formatCompanyCount(previewItems.length)}</span>
                        <span className={ppStyles.chip}>сильнее всего сегодня</span>
                      </div>

                      <div style={{ display: "grid", gap: "12px" }}>
                        {visiblePreviewItems.map((item) => (
                          <OnboardingPreviewCard key={`reentry-${item.org_id}-${item.rank}`} item={item} />
                        ))}

                        {hiddenPreviewItems.length > 0 ? (
                          <details className={ppStyles.disclosure}>
                            <summary className={ppStyles.disclosureSummary}>
                              Остальные компании: ещё {hiddenPreviewItems.length}
                            </summary>
                            <div className={ppStyles.disclosureBody}>
                              <div style={{ display: "grid", gap: "12px" }}>
                                {hiddenPreviewItems.map((item) => (
                                  <OnboardingPreviewCard key={`reentry-hidden-${item.org_id}-${item.rank}`} item={item} />
                                ))}
                              </div>
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  ) : previewError ? (
                    <NoticeBox
                      tone="danger"
                      title="Не удалось обновить радар"
                      description={previewUnavailableMessage}
                    />
                  ) : (
                    <NoticeBox
                      tone="neutral"
                      title="Сегодня радар спокоен"
                      description="Сильных компаний по текущему профилю пока нет. Можно вернуться позже."
                    />
                  )
                ) : null}

                {webPushConnectState ? (
                  <details className={ppStyles.disclosure}>
                    <summary className={ppStyles.disclosureSummary}>Быстрый возврат в радар</summary>
                    <div className={ppStyles.disclosureBody}>
                      <BrowserPushCard
                        configured={webPushConnectState.configured}
                        publicKey={webPushConnectState.publicKey}
                        connectToken={webPushConnectState.connectToken}
                        helperLabel={webPushConnectState.helperLabel}
                        activeSubscriptionCount={webPushStatus?.activeSubscriptionCount ?? 0}
                        serverStateLabel={webPushStatus?.stateLabel ?? "готовим"}
                        serverHelperLabel={webPushStatus?.helperLabel ?? webPushConnectState.helperLabel}
                      />
                    </div>
                  </details>
                ) : null}

                <details className={ppStyles.disclosure}>
                  <summary className={ppStyles.disclosureSummary}>Детали пилота</summary>
                  <div className={ppStyles.disclosureBody}>
                    <div className={ppStyles.summaryBox}>
                      <SummaryRow label="Агентство" value={profile?.agencyName ?? order.customerName ?? "не указано"} />
                      <SummaryRow label="Telegram" value={telegramDeliveryLabel} />
                      <SummaryRow label="Браузер" value={browserDeliveryLabel} />
                      <SummaryRow label="Доставка" value="ежедневно" />
                      <SummaryRow label="Город" value={profile?.targetCity ?? "-"} />
                      <SummaryRow
                        label="Компаний в день"
                        value={String(profile?.dailyDigestLimit ?? order.payload.dailyDigestLimit)}
                      />
                      <SummaryRow
                        label="Первая подборка"
                        value={
                          hasTestDigestSent
                            ? `отправлена ${formatDateTime(order.payload.onboardingTestDigestSentAt)}`
                            : "ещё не отправляли"
                        }
                      />
                    </div>
                  </div>
                </details>

                <div className={styles.actions}>
                  <Link href="/" className={ppStyles.secondaryAction}>
                    На главную
                  </Link>
                </div>
              </section>
            ) : null}
          </>
        )}
      </SurfaceCard>
    </PageFrame>
  );
}

function OnboardingPreviewCard(props: {
  item: OnboardingPreviewItem;
}) {
  const { item } = props;
  const primaryReason = item.reasons[0] ?? "Сейчас по компании есть повод выйти в контакт.";
  const secondaryReason = item.reasons[1] ?? null;
  const hasExtraContext = Boolean(secondaryReason) || item.source_families.length > 0;

  return (
    <article className={styles.previewCard}>
      <div className={styles.previewHeader}>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <strong style={{ fontSize: "1rem" }}>
            {item.rank}. {item.employer_name}
          </strong>
          {(() => {
            // T1.3 — speak the same score vocabulary as /leads: band label +
            // signal strength from the shared score-display module, instead of
            // the divergent raw "score 247.0" pill. No second vocab onboarding.
            const { bandLabel, strength } = formatPreviewScore(item.total_score);
            return (
              <span className={styles.scorePill} data-band={bandLabel}>
                {bandLabel} · {strength}
              </span>
            );
          })()}
          {item.confidence_gate ? (
            <span className={styles.previewChip}>Gate {item.confidence_gate}</span>
          ) : null}
        </div>
        <span style={{ color: "#64748b", fontSize: "0.9rem" }}>{formatVacanciesCount(item.vacancies_count)}</span>
      </div>

      <div className={styles.previewReasonList}>
        <div style={{ color: "#667085", fontSize: "0.78rem", fontWeight: 700 }}>Почему это важно</div>
        <div>{primaryReason}</div>
      </div>

      <div className={styles.opener}>
        <div className={styles.openerLabel}>Что делать дальше</div>
        <div>{item.opener}</div>
      </div>

      {hasExtraContext ? (
        <details className={ppStyles.disclosure}>
          <summary className={ppStyles.disclosureSummary}>Что ещё видно</summary>
          <div className={ppStyles.disclosureBody}>
            {secondaryReason ? <div className={ppStyles.helperText}>{secondaryReason}</div> : null}
            {item.source_families.length > 0 ? (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {item.source_families.slice(0, 2).map((label) => (
                  <span key={`${item.org_id}-${label}`} className={styles.previewChip}>
                    {label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function buildOnboardingStepFocus(input: {
  currentStep: CheckoutOrderOnboardingStep;
  previewCount: number;
  hasTestDigestSent: boolean;
  telegramConnected: boolean;
  hasPushRadarView: boolean;
}) {
  if (input.currentStep === "confirm-profile") {
    return {
      what: "профиль поиска на сегодня",
      why: "он определяет, какие компании попадут в радар и как будет выглядеть первый день",
      next: "сохранить профиль и перейти к Telegram"
    };
  }

  if (input.currentStep === "telegram") {
    return {
      what: "подключить Telegram",
      why: "без чата первый радар не уйдёт и ежедневный цикл не запустится",
      next: "открыть бота, нажать Start и вернуться сюда"
    };
  }

  if (input.currentStep === "preview") {
    if (input.previewCount === 0) {
      return {
        what: "сильных компаний пока нет",
        why: "по текущему профилю радар ещё не собрал достаточно сильный сигнал",
        next: "уточнить профиль или закончить настройку и вернуться позже"
      };
    }

    return {
      what: `${formatCompanyCount(input.previewCount)} уже в фокусе`,
      why: "по этим компаниям уже есть повод выходить в контакт",
      next: "отправить первый радар в Telegram"
    };
  }

  if (input.hasPushRadarView && input.previewCount > 0) {
    return {
      what: `${formatCompanyCount(input.previewCount)} сейчас в радаре`,
      why: "сильные компании уже собраны сверху и не требуют лишнего поиска",
      next: "начать с первых карточек и открыть нужную компанию"
    };
  }

  if (input.hasTestDigestSent) {
    return {
      what: "пилот уже запущен",
      why: "первый радар ушёл в чат и дальше цикл работает автоматически",
      next: "ждать следующий сигнал или вернуться позже"
    };
  }

  return {
    what: input.telegramConnected ? "профиль уже готов" : "настройка почти закончена",
    why: "ежедневный радар уже сможет приходить без ручного запуска",
    next: "вернуться позже или включить быстрый возврат в браузере"
  };
}

