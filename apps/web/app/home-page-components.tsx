import { chipStyle } from "./ui/page-primitives";

export function MetricRow(props: { label: string; value: string }) {
  return (
    <div style={metricRowStyle}>
      <strong>{props.label}</strong>
      <span>{props.value}</span>
    </div>
  );
}

export function formatVacanciesCount(value: number): string {
  if (value === 1) {
    return "1 вакансия";
  }

  if (value >= 2 && value <= 4) {
    return `${value} вакансии`;
  }

  return `${value} вакансий`;
}

export function buildFaqItems(paymentConfigured: boolean) {
  return [
    {
      question: "Для кого это?",
      answer:
        "Для агентств, рекрутеров и BD-команд, которым нужен не длинный поиск, а короткий список компаний с живым спросом на найм."
    },
    {
      question: "Что я вижу в радаре?",
      answer:
        "Компанию, силу сигнала, короткое объяснение, почему она в фокусе, и лучший угол первого контакта."
    },
    {
      question: "Нужен ли аккаунт, чтобы посмотреть пример?",
      answer: "Нет. Пример открывается сразу, без регистрации и без оплаты."
    },
    {
      question: "Что будет после оплаты?",
      answer: paymentConfigured
        ? "Сразу откроется настройка профиля, подключение Telegram и запуск первого ежедневного радара."
        : "Заказ сохранится. Как только оплата будет доступна, к запуску можно вернуться без повторного ввода профиля."
    }
  ] as const;
}

export const topBarStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "center",
  flexWrap: "wrap" as const
} as const;

export const heroGridStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.25fr) minmax(320px, 0.75fr)",
  gap: "18px",
  alignItems: "stretch"
} as const;

export const heroTitleStyle = {
  margin: 0,
  fontSize: "clamp(3.1rem, 7vw, 5.6rem)",
  lineHeight: 0.9,
  letterSpacing: "-0.06em",
  maxWidth: "11ch"
} as const;

export const heroTextStyle = {
  margin: 0,
  maxWidth: "720px",
  color: "#4b5565",
  fontSize: "1.04rem",
  lineHeight: 1.7
} as const;

export const heroFootnoteStyle = {
  color: "#7b8798",
  fontSize: "0.92rem",
  lineHeight: 1.62,
  maxWidth: "72ch"
} as const;

export const heroStatGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "12px"
} as const;

export const heroStatValueStyle = {
  fontSize: "1.28rem",
  fontWeight: 800,
  color: "#0f172a"
} as const;

export const heroStatLabelStyle = {
  color: "#667487",
  fontSize: "0.84rem",
  lineHeight: 1.45
} as const;

export const mutedPanelStyle = {
  padding: "14px 16px",
  borderRadius: "18px",
  border: "1px solid rgba(148, 163, 184, 0.14)",
  backgroundColor: "rgba(255, 255, 255, 0.72)",
  display: "grid",
  gap: "4px",
  backdropFilter: "blur(8px)"
} as const;

export const proofGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "10px"
} as const;

export const proofItemStyle = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
  padding: "12px 14px",
  borderRadius: "16px",
  border: "1px solid rgba(148, 163, 184, 0.14)",
  backgroundColor: "rgba(255, 255, 255, 0.78)",
  color: "#334155",
  fontWeight: 600,
  backdropFilter: "blur(8px)"
} as const;

export const metricRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  color: "#344054",
  paddingBottom: "10px",
  borderBottom: "1px solid rgba(15, 23, 42, 0.08)"
} as const;

export const previewGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: "18px"
} as const;

export const previewHeaderRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap" as const,
  alignItems: "center"
} as const;

export const previewCardStyle = {
  padding: "20px",
  borderRadius: "22px",
  border: "1px solid rgba(15, 23, 42, 0.08)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.96) 100%)",
  display: "grid",
  gap: "14px",
  boxShadow: "0 16px 40px rgba(15, 23, 42, 0.08)"
} as const;

export const previewCardHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap" as const,
  alignItems: "center"
} as const;

export const scorePillStyle = {
  padding: "4px 9px",
  borderRadius: "999px",
  border: "1px solid rgba(29, 78, 216, 0.12)",
  backgroundColor: "#f4f8ff",
  color: "#1d4ed8",
  fontSize: "0.76rem",
  fontWeight: 700
} as const;

export const chipToneStyle = {
  ...chipStyle,
  border: "1px solid rgba(15, 23, 42, 0.06)",
  color: "#475467"
};

export const previewReasonListStyle = {
  display: "grid",
  gap: "6px",
  color: "#334155",
  lineHeight: 1.58
} as const;

export const openerBoxStyle = {
  padding: "13px 14px",
  borderRadius: "16px",
  border: "1px solid rgba(15, 23, 42, 0.07)",
  backgroundColor: "#fbfcfd",
  color: "#344054",
  lineHeight: 1.6,
  display: "grid",
  gap: "6px"
} as const;

export const openerLabelStyle = {
  color: "#667487",
  fontSize: "0.76rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const
} as const;

export const stepsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: "14px"
} as const;

export const stepTitleStyle = {
  margin: 0,
  fontSize: "1.08rem"
} as const;

export const stepTextStyle = {
  margin: 0,
  color: "#667487",
  lineHeight: 1.65
} as const;

export const pricingGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "14px"
} as const;

export const primaryPlanCardStyle = {
  display: "grid",
  gap: "16px",
  border: "1px solid rgba(37, 99, 235, 0.16)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(239,246,255,0.96) 100%)",
  boxShadow: "0 16px 42px rgba(37, 99, 235, 0.12)"
} as const;

export const secondaryPlanCardStyle = {
  display: "grid",
  gap: "16px",
  border: "1px solid rgba(15, 23, 42, 0.06)",
  backgroundColor: "rgba(255,255,255,0.8)"
} as const;

export const planDescriptionStyle = {
  margin: 0,
  color: "#445164",
  lineHeight: 1.65
} as const;

export const featureRowStyle = {
  display: "flex",
  gap: "10px",
  alignItems: "flex-start",
  color: "#344054",
  lineHeight: 1.6
} as const;

export const featureDotStyle = {
  width: "6px",
  height: "6px",
  marginTop: "10px",
  borderRadius: "999px",
  backgroundColor: "#101828",
  flexShrink: 0
} as const;

export const faqCardStyle = {
  padding: "16px 18px",
  borderRadius: "18px",
  border: "1px solid rgba(15, 23, 42, 0.08)",
  backgroundColor: "rgba(255, 255, 255, 0.88)",
  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.05)"
} as const;

export const faqSummaryStyle = {
  cursor: "pointer",
  display: "block",
  fontWeight: 700,
  listStyle: "none"
} as const;

export const faqAnswerStyle = {
  marginTop: "12px",
  color: "#667487",
  lineHeight: 1.65
} as const;
