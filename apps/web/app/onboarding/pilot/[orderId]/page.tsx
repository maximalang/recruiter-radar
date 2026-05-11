import Link from "next/link";
import { notFound } from "next/navigation";

import { FormSubmitButton } from "../../../ui/form-submit-button";
import {
  PageFrame,
  SectionIntro,
  StatusBadge,
  SurfaceCard,
  SummaryRow,
  ThreeQuestionPanel,
  NoticeBox,
  backLinkStyle,
  chipStyle,
  disclosureBodyStyle,
  disclosureStyle,
  disclosureSummaryStyle,
  fieldStyle,
  fieldLabelStyle,
  helperTextStyle,
  inputStyle,
  textareaStyle,
  primaryActionStyle,
  secondaryActionStyle,
  mutedActionStyle,
  summaryBoxStyle
} from "../../../ui/page-primitives";
import {
  formatKeywordText,
  getClientProfileById
} from "../../../../lib/clientProfiles";
import { getHhDigestItems } from "../../../../lib/hhDigest";
import { getClientProfileWebPushStatuses } from "../../../../lib/webPushSubscriptions";
import {
  ensurePilotOrderOnboardingReady,
  getPilotActivationReadiness,
  type CheckoutOrder,
  type CheckoutOrderOnboardingStep
} from "../../../../lib/payments";
import { getTelegramConnectLinkState } from "../../../../lib/telegramConnect";
import { getWebPushConnectLinkState } from "../../../../lib/webPushConnect";
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
  actionsStyle,
  formStyle,
  formatCompanyCount,
  formatDateTime,
  formatVacanciesCount,
  instructionCardStyle,
  instructionGridStyle,
  openerLabelStyle,
  openerStyle,
  previewCardStyle,
  previewChipStyle,
  previewHeaderStyle,
  previewReasonListStyle,
  scorePillStyle,
  stepNumberStyle,
  stepPillStyle,
  stepRailStyle,
  submitRowStyle,
  translateOrderStatus,
  getCurrentStep,
  getRequestedStep,
  getSearchParamValue,
  isStepComplete,
  wizardSectionStyle
} from "./pilot-onboarding-components";

export const dynamic = "force-dynamic";

type PilotOnboardingPageProps = {
  params: Promise<{
    orderId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const stepItems: Array<{
  key: CheckoutOrderOnboardingStep;
  label: string;
  number: string;
}> = [
  { key: "confirm-profile", label: "Профиль", number: "01" },
  { key: "telegram", label: "Telegram", number: "02" },
  { key: "preview", label: "Радар", number: "03" },
  { key: "complete", label: "Готово", number: "04" }
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
  const order = await ensurePilotOrderOnboardingReady(resolvedParams.orderId);

  if (!order) {
    notFound();
  }

  const profile = order.payload.clientProfileId
    ? await getClientProfileById(order.payload.clientProfileId).catch(() => null)
    : null;
  const readiness = await getPilotActivationReadiness(order.id);
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
  const deliveryPrerequisitesReady = Boolean(readiness?.telegramConnected && process.env.TELEGRAM_BOT_TOKEN);
  const firstDigestHasCandidates = previewItems.length > 0;
  const firstDigestReady = deliveryPrerequisitesReady && firstDigestHasCandidates;
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
  const stepFocus = buildOnboardingStepFocus({
    currentStep,
    previewCount: previewItems.length,
    hasTestDigestSent,
    telegramConnected: Boolean(profile?.telegramChatId),
    hasPushRadarView: showPushRadarView
  });

  return (
    <PageFrame maxWidth="860px">
      <Link href="/" style={backLinkStyle}>
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
            <SummaryRow label="Профиль создан" value={readiness?.profileExists ? "да" : "нет"} />
            <SummaryRow
              label="Telegram подключён"
              value={readiness?.telegramConnected ? "да" : "нет"}
            />
            <SummaryRow
              label="Первый радар готов"
              value={firstDigestReady ? "да" : "нет"}
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

          <details style={disclosureStyle}>
            <summary style={disclosureSummaryStyle}>Детали запуска</summary>
            <div style={disclosureBodyStyle}>
              <div style={summaryBoxStyle}>
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
            <div style={stepRailStyle}>
              {stepItems.map((step) => (
                <div
                  key={step.key}
                  style={stepPillStyle(
                    step.key === currentStep,
                    isStepComplete(step.key, currentStep)
                  )}
                >
                  <span style={stepNumberStyle}>{step.number}</span>
                  <span>{step.label}</span>
                </div>
              ))}
            </div>

            {currentStep === "confirm-profile" ? (
              <section style={wizardSectionStyle}>
                <SectionIntro
                  eyebrow="Шаг 1"
                  title="Проверьте профиль поиска"
                  description="Оставьте только то, что реально меняет подборку."
                />

                <form action={confirmPilotProfileAction} style={formStyle}>
                  <input type="hidden" name="orderId" value={order.id} />

                  <label style={fieldStyle}>
                    <span style={fieldLabelStyle}>Название профиля</span>
                    <input
                      name="agencyName"
                      required
                      defaultValue={profile?.agencyName ?? order.customerName ?? "Клиент Recruiter Radar"}
                      placeholder="Название профиля"
                      style={inputStyle}
                    />
                  </label>

                  <details style={{ ...disclosureStyle, gridColumn: "1 / -1" }}>
                    <summary style={disclosureSummaryStyle}>Уточнить профиль</summary>
                    <div style={disclosureBodyStyle}>
                      <label style={fieldStyle}>
                        <span style={fieldLabelStyle}>Компаний в день</span>
                        <input
                          name="dailyDigestLimit"
                          type="number"
                          min={1}
                          max={10}
                          defaultValue={profile?.dailyDigestLimit ?? order.payload.dailyDigestLimit}
                          style={inputStyle}
                        />
                        <span style={helperTextStyle}>От 1 до 10 компаний в одной подборке.</span>
                      </label>

                      <label style={fieldStyle}>
                        <span style={fieldLabelStyle}>Где искать (необязательно)</span>
                        <input
                          name="targetCity"
                          defaultValue={profile?.targetCity ?? order.payload.city ?? ""}
                          placeholder="Москва / Берлин / удалённо"
                          style={inputStyle}
                        />
                      </label>

                      <label style={fieldStyle}>
                        <span style={fieldLabelStyle}>Что искать (необязательно)</span>
                        <input
                          name="specialization"
                          defaultValue={profile?.specialization ?? order.payload.specialization ?? ""}
                          placeholder="IT-рекрутмент / подбор в продажи"
                          style={inputStyle}
                        />
                      </label>

                      <label style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
                        <span style={fieldLabelStyle}>Что важно (необязательно)</span>
                        <textarea
                          name="includeKeywords"
                          rows={4}
                          defaultValue={formatKeywordText(profile?.includeKeywords ?? order.payload.includeKeywords)}
                          placeholder={"рекрутер\nсорсинг\nагентство"}
                          style={textareaStyle}
                        />
                        <span style={helperTextStyle}>По одной фразе на строку.</span>
                      </label>

                      <label style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
                        <span style={fieldLabelStyle}>Что исключить (необязательно)</span>
                        <textarea
                          name="excludeKeywords"
                          rows={4}
                          defaultValue={formatKeywordText(profile?.excludeKeywords ?? order.payload.excludeKeywords)}
                          placeholder={"вахта\nзавод\nстажировка"}
                          style={textareaStyle}
                        />
                        <span style={helperTextStyle}>По одной фразе на строку.</span>
                      </label>
                    </div>
                  </details>

                  <div style={submitRowStyle}>
                    <FormSubmitButton
                      idleLabel="Сохранить и продолжить"
                      pendingLabel="Сохраняем..."
                      style={primaryActionStyle}
                    />
                    <div style={helperTextStyle}>
                      Дальше подключим Telegram.
                    </div>
                  </div>
                </form>
              </section>
            ) : null}

            {currentStep === "telegram" ? (
              <section style={wizardSectionStyle}>
                <TelegramStepAutoRefresh />

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
                    <div style={instructionGridStyle}>
                      <InstructionCard>
                        1. Откройте {telegramConnectState?.botUsername ? `@${telegramConnectState.botUsername}` : "бот Recruiter Radar"}.
                      </InstructionCard>
                      <InstructionCard>2. Нажмите Start в чате.</InstructionCard>
                      <InstructionCard>3. Вернитесь сюда. Подключение подтянется само.</InstructionCard>
                    </div>

                    {telegramConnectState?.connectUrl ? (
                      <div style={{ display: "grid", gap: "10px" }}>
                        <div style={actionsStyle}>
                          <a href={telegramConnectState.connectUrl} style={primaryActionStyle}>
                            Открыть Telegram
                          </a>
                        </div>
                        <div style={helperTextStyle}>
                          Если ссылка устареет, просто обновите страницу.
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </section>
            ) : null}

            {currentStep === "preview" ? (
              <section style={wizardSectionStyle}>
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

                    <div style={actionsStyle}>
                      <Link
                        href={`/onboarding/pilot/${order.id}?step=confirm-profile`}
                        style={primaryActionStyle}
                      >
                        Вернуться к профилю
                      </Link>
                      <form action={completePilotOnboardingAction} style={{ margin: 0 }}>
                        <input type="hidden" name="orderId" value={order.id} />
                        <FormSubmitButton
                          idleLabel="Закончить и вернуться позже"
                          pendingLabel="Завершаем..."
                          style={mutedActionStyle}
                        />
                      </form>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "grid", gap: "10px" }}>
                      <form action={sendPilotTestDigestAction} style={{ margin: 0 }}>
                        <input type="hidden" name="orderId" value={order.id} />
                        <FormSubmitButton
                          idleLabel="Отправить первый радар"
                          pendingLabel="Отправляем в Telegram..."
                          style={primaryActionStyle}
                        />
                      </form>
                      <div style={helperTextStyle}>
                        Это тестовый запуск. Дальше ежедневный радар будет приходить автоматически при активном пилоте.
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: "12px" }}>
                      {visiblePreviewItems.map((item) => (
                        <OnboardingPreviewCard key={`${item.orgId}-${item.rank}`} item={item} />
                      ))}

                      {hiddenPreviewItems.length > 0 ? (
                        <details style={disclosureStyle}>
                          <summary style={disclosureSummaryStyle}>
                            Остальные компании: ещё {hiddenPreviewItems.length}
                          </summary>
                          <div style={disclosureBodyStyle}>
                            <div style={{ display: "grid", gap: "12px" }}>
                              {hiddenPreviewItems.map((item) => (
                                <OnboardingPreviewCard key={`${item.orgId}-${item.rank}`} item={item} />
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
              <section style={wizardSectionStyle}>
                <div style={{ display: "grid", gap: "10px" }}>
                  <StatusBadge tone="success">
                    {hasTestDigestSent ? "Первый радар отправлен" : "Пилот включён"}
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
                    !deliveryPrerequisitesReady
                      ? "Доставка в Telegram ещё не настроена до конца. Проверьте подключение чата и конфигурацию доставки, затем вернитесь к запуску первого радара."
                      : hasTestDigestSent
                        ? "Откройте Telegram, отметьте релевантность карточек и используйте обратную связь — это улучшит следующие радары."
                        : !firstDigestHasCandidates
                          ? "Сейчас сильных кандидатов нет: уточните профиль, дождитесь более сильного сигнала или завершите настройку и вернитесь позже."
                          : "Отправьте первый радар в Telegram и после отправки отметьте релевантность карточек, чтобы улучшить следующие радары."
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
                        <span style={chipStyle}>{formatCompanyCount(previewItems.length)}</span>
                        <span style={chipStyle}>сильнее всего сегодня</span>
                      </div>

                      <div style={{ display: "grid", gap: "12px" }}>
                        {visiblePreviewItems.map((item) => (
                          <OnboardingPreviewCard key={`reentry-${item.orgId}-${item.rank}`} item={item} />
                        ))}

                        {hiddenPreviewItems.length > 0 ? (
                          <details style={disclosureStyle}>
                            <summary style={disclosureSummaryStyle}>
                              Остальные компании: ещё {hiddenPreviewItems.length}
                            </summary>
                            <div style={disclosureBodyStyle}>
                              <div style={{ display: "grid", gap: "12px" }}>
                                {hiddenPreviewItems.map((item) => (
                                  <OnboardingPreviewCard key={`reentry-hidden-${item.orgId}-${item.rank}`} item={item} />
                                ))}
                              </div>
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <NoticeBox
                      tone="neutral"
                      title="Сегодня радар спокоен"
                      description="Сильных компаний по текущему профилю пока нет. Можно вернуться позже."
                    />
                  )
                ) : null}

                {webPushConnectState ? (
                  <details style={disclosureStyle}>
                    <summary style={disclosureSummaryStyle}>Быстрый возврат в радар</summary>
                    <div style={disclosureBodyStyle}>
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

                <details style={disclosureStyle}>
                  <summary style={disclosureSummaryStyle}>Детали пилота</summary>
                  <div style={disclosureBodyStyle}>
                    <div style={summaryBoxStyle}>
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

                <div style={actionsStyle}>
                  <Link href="/" style={secondaryActionStyle}>
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
  const hasExtraContext = Boolean(secondaryReason) || item.sourceFamilies.length > 0;

  return (
    <article style={previewCardStyle}>
      <div style={previewHeaderStyle}>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <strong style={{ fontSize: "1rem" }}>
            {item.rank}. {item.employer_name}
          </strong>
          <span style={scorePillStyle}>score {item.total_score.toFixed(1)}</span>
        </div>
        <span style={{ color: "#64748b", fontSize: "0.9rem" }}>{formatVacanciesCount(item.vacancies_count)}</span>
      </div>

      <div style={previewReasonListStyle}>
        <div style={{ color: "#667085", fontSize: "0.78rem", fontWeight: 700 }}>Почему это важно</div>
        <div>{primaryReason}</div>
      </div>

      <div style={openerStyle}>
        <div style={openerLabelStyle}>Что делать дальше</div>
        <div>{item.opener}</div>
      </div>

      {hasExtraContext ? (
        <details style={disclosureStyle}>
          <summary style={disclosureSummaryStyle}>Что ещё видно</summary>
          <div style={disclosureBodyStyle}>
            {secondaryReason ? <div style={helperTextStyle}>{secondaryReason}</div> : null}
            {item.sourceFamilies.length > 0 ? (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {item.sourceFamilies.slice(0, 2).map((label) => (
                  <span key={`${item.orgId}-${label}`} style={previewChipStyle}>
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

