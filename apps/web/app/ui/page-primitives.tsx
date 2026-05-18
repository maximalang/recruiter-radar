import type { CSSProperties, ReactNode } from "react";

import { repairPossiblyMojibakeText } from "../../lib/copy/repair";

export function PageFrame(props: {
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <main style={pageFrameStyle}>
      <div
        style={{
          maxWidth: props.maxWidth ?? "1080px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          gap: "18px"
        }}
      >
        {props.children}
      </div>
    </main>
  );
}

export function SurfaceCard(props: {
  children: ReactNode;
  padding?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        ...surfaceCardStyle,
        padding: props.padding ?? "22px",
        ...props.style
      }}
    >
      {props.children}
    </section>
  );
}

export function StatusBadge(props: {
  children: ReactNode;
  tone?: BadgeTone;
  style?: CSSProperties;
}) {
  return (
    <div style={{ ...badgeStyle(props.tone ?? "neutral"), ...props.style }}>
      {repairVisibleNode(props.children)}
    </div>
  );
}

export function NoticeBox(props: {
  title?: string;
  description?: ReactNode;
  children?: ReactNode;
  tone?: NoticeTone;
  style?: CSSProperties;
}) {
  return (
    <div style={{ ...noticeStyle(props.tone ?? "neutral"), ...props.style }}>
      {props.title ? <div style={noticeTitleStyle}>{repairVisibleNode(props.title)}</div> : null}
      {props.description ? (
        <div style={noticeTextStyle}>{repairVisibleNode(props.description)}</div>
      ) : null}
      {props.children}
    </div>
  );
}

export function SummaryRow(props: {
  label: ReactNode;
  value: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ ...summaryRowStyle, ...props.style }}>
      <span style={summaryLabelStyle}>{repairVisibleNode(props.label)}</span>
      <strong style={summaryValueStyle}>{repairVisibleNode(props.value)}</strong>
    </div>
  );
}

export function SectionIntro(props: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ ...sectionIntroStyle, ...props.style }}>
      {props.eyebrow ? <div style={sectionEyebrowStyle}>{repairVisibleNode(props.eyebrow)}</div> : null}
      <h2 style={sectionTitleStyle}>{repairVisibleNode(props.title)}</h2>
      {props.description ? <p style={sectionDescriptionStyle}>{repairVisibleNode(props.description)}</p> : null}
    </div>
  );
}

export function ThreeQuestionPanel(props: {
  whatLabel?: string;
  whatValue: ReactNode;
  whyLabel?: string;
  whyValue: ReactNode;
  nextLabel?: string;
  nextValue: ReactNode;
  style?: CSSProperties;
}) {
  const items = [
    {
      label: props.whatLabel ?? "Что важно сегодня",
      value: props.whatValue
    },
    {
      label: props.whyLabel ?? "Почему это важно",
      value: props.whyValue
    },
    {
      label: props.nextLabel ?? "Что делать дальше",
      value: props.nextValue
    }
  ];

  return (
    <div style={{ ...threeQuestionGridStyle, ...props.style }}>
      {items.map((item) => (
        <div key={item.label} style={threeQuestionCardStyle}>
          <div style={threeQuestionLabelStyle}>{repairVisibleNode(item.label)}</div>
          <div style={threeQuestionValueStyle}>{repairVisibleNode(item.value)}</div>
        </div>
      ))}
    </div>
  );
}

function repairVisibleNode(value: ReactNode): ReactNode {
  return typeof value === "string" ? repairPossiblyMojibakeText(value) : value;
}

export const pageFrameStyle = {
  minHeight: "100vh",
  padding: "32px 20px 72px",
  background:
    "radial-gradient(circle at top, rgba(59, 130, 246, 0.08), transparent 28%), linear-gradient(180deg, #f8fbff 0%, #f3f6fb 28%, #eef2f7 100%)",
  color: "#0f172a",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
} as const;

export const surfaceCardStyle = {
  border: "1px solid rgba(15, 23, 42, 0.08)",
  borderRadius: "24px",
  background: "rgba(255, 255, 255, 0.94)",
  boxShadow: "0 18px 60px rgba(15, 23, 42, 0.08)",
  backdropFilter: "blur(10px)",
  minWidth: 0
} as const;

export const backLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  width: "fit-content",
  padding: "6px 11px",
  borderRadius: "999px",
  border: "1px solid rgba(15, 23, 42, 0.08)",
  backgroundColor: "#ffffff",
  color: "#596579",
  textDecoration: "none",
  fontSize: "0.88rem",
  fontWeight: 600
} as const;

export const brandLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  width: "fit-content",
  padding: "6px 11px",
  borderRadius: "999px",
  border: "1px solid rgba(15, 23, 42, 0.08)",
  backgroundColor: "#ffffff",
  color: "#0f172a",
  textDecoration: "none",
  fontWeight: 750,
  fontSize: "0.95rem"
} as const;

export const fieldStyle = {
  display: "grid",
  gap: "6px"
} as const;

export const fieldLabelStyle = {
  fontSize: "0.84rem",
  color: "#526071",
  fontWeight: 600
} as const;

export const helperTextStyle = {
  fontSize: "0.81rem",
  color: "#667085",
  lineHeight: 1.5
} as const;

export const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid rgba(15, 23, 42, 0.1)",
  backgroundColor: "rgba(255, 255, 255, 0.96)",
  color: "#0f172a",
  fontSize: "0.95rem",
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
  boxSizing: "border-box" as const
};

export const textareaStyle = {
  ...inputStyle,
  resize: "vertical" as const,
  minHeight: "96px"
};

export const disclosureStyle = {
  border: "1px solid rgba(15, 23, 42, 0.08)",
  borderRadius: "18px",
  backgroundColor: "rgba(248, 250, 252, 0.86)",
  overflow: "hidden"
} as const;

export const disclosureSummaryStyle = {
  cursor: "pointer",
  display: "block",
  listStyle: "none",
  minWidth: 0,
  padding: "12px 14px",
  backgroundColor: "rgba(248, 250, 252, 0.78)",
  color: "#0f172a",
  fontSize: "0.84rem",
  fontWeight: 700
} as const;

export const disclosureBodyStyle = {
  display: "grid",
  gap: "12px",
  padding: "0 14px 14px",
  borderTop: "1px solid rgba(15, 23, 42, 0.06)"
} as const;

export const primaryActionStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 18px",
  borderRadius: "14px",
  border: "1px solid rgba(15, 23, 42, 0.9)",
  background: "linear-gradient(135deg, #111827 0%, #1f3a8a 100%)",
  boxShadow: "0 14px 30px rgba(30, 64, 175, 0.24)",
  color: "#ffffff",
  textDecoration: "none",
  fontSize: "0.94rem",
  fontWeight: 700,
  cursor: "pointer"
} as const;

export const secondaryActionStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 18px",
  borderRadius: "14px",
  border: "1px solid rgba(15, 23, 42, 0.1)",
  backgroundColor: "rgba(255, 255, 255, 0.86)",
  color: "#111827",
  textDecoration: "none",
  fontSize: "0.94rem",
  fontWeight: 700,
  cursor: "pointer",
  backdropFilter: "blur(8px)"
} as const;

export const mutedActionStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "9px 13px",
  borderRadius: "12px",
  border: "1px solid rgba(15, 23, 42, 0.06)",
  backgroundColor: "#f8fafc",
  color: "#667085",
  textDecoration: "none",
  fontSize: "0.9rem",
  fontWeight: 600,
  cursor: "pointer"
} as const;

export const destructiveActionStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 14px",
  borderRadius: "12px",
  border: "1px solid rgba(185, 28, 28, 0.16)",
  backgroundColor: "#fff7f7",
  color: "#b42318",
  textDecoration: "none",
  fontSize: "0.9rem",
  fontWeight: 700,
  cursor: "pointer"
} as const;

export const inlineActionStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  width: "fit-content",
  padding: 0,
  border: "none",
  background: "transparent",
  color: "#667487",
  textDecoration: "none",
  fontSize: "0.9rem",
  fontWeight: 600,
  cursor: "pointer"
} as const;

export const sectionIntroStyle = {
  display: "grid",
  gap: "8px"
} as const;

export const sectionEyebrowStyle = {
  color: "#475467",
  fontSize: "0.76rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const
} as const;

export const sectionTitleStyle = {
  margin: 0,
  fontSize: "clamp(1.7rem, 2.5vw, 2.3rem)",
  lineHeight: 1.04,
  letterSpacing: "-0.03em"
} as const;

export const sectionDescriptionStyle = {
  margin: 0,
  color: "#5f6b7a",
  lineHeight: 1.62,
  maxWidth: "62ch",
  fontSize: "1rem"
} as const;

export const summaryBoxStyle = {
  display: "grid",
  gap: "8px",
  padding: "12px 14px",
  borderRadius: "16px",
  border: "1px solid rgba(15, 23, 42, 0.06)",
  backgroundColor: "#fbfcfd"
} as const;

export const summaryRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "12px",
  alignItems: "flex-start",
  padding: "2px 0"
} as const;

export const summaryLabelStyle = {
  color: "#667085",
  fontSize: "0.84rem"
} as const;

export const summaryValueStyle = {
  color: "#0f172a",
  fontSize: "0.88rem"
} as const;

export const threeQuestionGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "10px"
} as const;

export const threeQuestionCardStyle = {
  display: "grid",
  gap: "6px",
  padding: "12px 14px",
  borderRadius: "16px",
  border: "1px solid rgba(15, 23, 42, 0.06)",
  backgroundColor: "#fbfcfd"
} as const;

export const threeQuestionLabelStyle = {
  color: "#667085",
  fontSize: "0.8rem",
  fontWeight: 700
} as const;

export const threeQuestionValueStyle = {
  color: "#0f172a",
  fontSize: "0.92rem",
  fontWeight: 600,
  lineHeight: 1.55
} as const;

export const chipStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 9px",
  borderRadius: "999px",
  border: "1px solid rgba(15, 23, 42, 0.08)",
  backgroundColor: "#f8fafc",
  color: "#475467",
  fontSize: "0.76rem",
  fontWeight: 600
} as const;

export const workspaceSplitStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: "18px",
  alignItems: "start"
} as const;

export const workspaceSidePanelStyle = {
  display: "grid",
  gap: "12px",
  alignContent: "start"
} as const;

export const workspacePanelStyle = {
  display: "grid",
  gap: "12px",
  padding: "14px 16px",
  borderRadius: "16px",
  border: "1px solid rgba(15, 23, 42, 0.06)",
  backgroundColor: "#fbfcfd"
} as const;

export const workspacePanelTitleStyle = {
  color: "#0f172a",
  fontSize: "0.9rem",
  fontWeight: 700
} as const;

export const workspacePanelTextStyle = {
  color: "#5f6b7a",
  fontSize: "0.88rem",
  lineHeight: 1.55
} as const;

type BadgeTone = "neutral" | "success" | "info" | "warning" | "danger";
type NoticeTone = "neutral" | "success" | "info" | "warning" | "danger";

function badgeStyle(tone: BadgeTone) {
  if (tone === "success") {
    return {
      display: "inline-flex",
      alignItems: "center",
      padding: "5px 10px",
      borderRadius: "999px",
      border: "1px solid rgba(4, 120, 87, 0.14)",
      backgroundColor: "#f4fbf7",
      color: "#166534",
      fontSize: "0.76rem",
      fontWeight: 700
    } as const;
  }

  if (tone === "info") {
    return {
      display: "inline-flex",
      alignItems: "center",
      padding: "5px 10px",
      borderRadius: "999px",
      border: "1px solid rgba(29, 78, 216, 0.14)",
      backgroundColor: "#f4f8ff",
      color: "#1d4ed8",
      fontSize: "0.76rem",
      fontWeight: 700
    } as const;
  }

  if (tone === "warning") {
    return {
      display: "inline-flex",
      alignItems: "center",
      padding: "5px 10px",
      borderRadius: "999px",
      border: "1px solid rgba(194, 65, 12, 0.14)",
      backgroundColor: "#fff8f1",
      color: "#c2410c",
      fontSize: "0.76rem",
      fontWeight: 700
    } as const;
  }

  if (tone === "danger") {
    return {
      display: "inline-flex",
      alignItems: "center",
      padding: "5px 10px",
      borderRadius: "999px",
      border: "1px solid rgba(185, 28, 28, 0.14)",
      backgroundColor: "#fff7f7",
      color: "#991b1b",
      fontSize: "0.76rem",
      fontWeight: 700
    } as const;
  }

  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "5px 10px",
    borderRadius: "999px",
    border: "1px solid rgba(15, 23, 42, 0.08)",
    backgroundColor: "#f8fafc",
    color: "#475467",
    fontSize: "0.76rem",
    fontWeight: 700
  } as const;
}

function noticeStyle(tone: NoticeTone) {
  if (tone === "success") {
    return {
      padding: "14px 16px",
      borderRadius: "16px",
      border: "1px solid rgba(4, 120, 87, 0.14)",
      backgroundColor: "#f4fbf7",
      color: "#166534",
      display: "grid",
      gap: "8px"
    } as const;
  }

  if (tone === "info") {
    return {
      padding: "14px 16px",
      borderRadius: "16px",
      border: "1px solid rgba(29, 78, 216, 0.14)",
      backgroundColor: "#f4f8ff",
      color: "#1d4ed8",
      display: "grid",
      gap: "8px"
    } as const;
  }

  if (tone === "warning") {
    return {
      padding: "14px 16px",
      borderRadius: "16px",
      border: "1px solid rgba(194, 65, 12, 0.14)",
      backgroundColor: "#fff8f1",
      color: "#9a3412",
      display: "grid",
      gap: "8px"
    } as const;
  }

  if (tone === "danger") {
    return {
      padding: "14px 16px",
      borderRadius: "16px",
      border: "1px solid rgba(185, 28, 28, 0.14)",
      backgroundColor: "#fff7f7",
      color: "#991b1b",
      display: "grid",
      gap: "8px"
    } as const;
  }

  return {
    padding: "14px 16px",
    borderRadius: "16px",
    border: "1px solid rgba(15, 23, 42, 0.08)",
    backgroundColor: "#fbfcfd",
    color: "#475467",
    display: "grid",
    gap: "8px"
  } as const;
}

const noticeTitleStyle = {
  fontWeight: 700
} as const;

const noticeTextStyle = {
  lineHeight: 1.6
} as const;
