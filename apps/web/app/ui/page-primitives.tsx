import type { ReactNode } from "react";

import styles from "./page-primitives.module.css";
import { repairPossiblyMojibakeText } from "../../lib/copy/repair";

export function PageFrame(props: {
  children: ReactNode;
  maxWidth?: string;
  className?: string;
  dataDeployAnchor?: string;
  as?: "main" | "div";
}) {
  const Frame = props.as ?? "main";

  return (
    <Frame
      className={`${styles.pageFrame}${props.className ? ` ${props.className}` : ""}`}
      data-deploy-anchor={props.dataDeployAnchor}
      data-ui-system="recruiter-radar-v6"
    >
      <div
        style={{
          maxWidth: props.maxWidth ?? "1080px",
        }}
        className={styles.pageFrameInner}
      >
        {props.children}
      </div>
    </Frame>
  );
}

export function SurfaceCard(props: {
  children: ReactNode;
  padding?: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <section
      className={`${styles.surfaceCard}${props.className ? ` ${props.className}` : ""}`}
      style={{
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
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`${styles.badge}${props.className ? ` ${props.className}` : ""}`}
      data-tone={props.tone ?? "neutral"}
      style={props.style}
    >
      {repairVisibleNode(props.children)}
    </div>
  );
}

export function NoticeBox(props: {
  title?: string;
  description?: ReactNode;
  children?: ReactNode;
  tone?: NoticeTone;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={styles.notice}
      data-tone={props.tone ?? "neutral"}
      style={props.style}
    >
      {props.title ? <div className={styles.noticeTitle}>{repairVisibleNode(props.title)}</div> : null}
      {props.description ? (
        <div className={styles.noticeText}>{repairVisibleNode(props.description)}</div>
      ) : null}
      {props.children}
    </div>
  );
}

export function SummaryRow(props: {
  label: ReactNode;
  value: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className={styles.summaryRow} style={props.style}>
      <span className={styles.summaryLabel}>{repairVisibleNode(props.label)}</span>
      <strong className={styles.summaryValue}>{repairVisibleNode(props.value)}</strong>
    </div>
  );
}

export function SectionIntro(props: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  style?: React.CSSProperties;
  /** Brand-accent eyebrow variant: a brand-tinted label with a leading dot.
   *  Used on the landing to give section heads a structured, premium read.
   *  Default (false) keeps the minimal plain eyebrow used on legal/privacy/
   *  terms/checkout — so existing pages are unchanged. */
  accent?: boolean;
}) {
  return (
    <div className={styles.sectionIntro} style={props.style}>
      {props.eyebrow ? (
        <div
          className={`${styles.sectionEyebrow}${props.accent ? ` ${styles.sectionEyebrowAccent}` : ""}`}
        >
          {repairVisibleNode(props.eyebrow)}
        </div>
      ) : null}
      <h2 className={styles.sectionTitle}>{repairVisibleNode(props.title)}</h2>
      {props.description ? <p className={styles.sectionDescription}>{repairVisibleNode(props.description)}</p> : null}
    </div>
  );
}

function repairVisibleNode(value: ReactNode): ReactNode {
  return typeof value === "string" ? repairPossiblyMojibakeText(value) : value;
}

type BadgeTone = "neutral" | "success" | "info" | "warning" | "danger";
type NoticeTone = "neutral" | "success" | "info" | "warning" | "danger";
