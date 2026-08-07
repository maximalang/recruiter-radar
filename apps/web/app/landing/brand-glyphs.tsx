import styles from "./landing.module.css";

type GlyphProps = { size?: number; className?: string };

export function SignalGlyph({ size = 52, className }: GlyphProps) {
  return (
    <svg
      className={`${styles.glyph} ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 52 52"
      fill="none"
      aria-hidden="true"
    >
      <path d="M13.2 20.3a14.5 14.5 0 0 1 19.4-7.1" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" opacity=".38" />
      <path d="M38.8 20.6a14.5 14.5 0 0 1-7.4 17.6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" opacity=".62" />
      <path d="M24.1 40.4a14.5 14.5 0 0 1-11.2-10.7" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" opacity=".28" />
      <circle cx="34.8" cy="15.8" r="2.8" fill="currentColor" />
      <circle cx="38.9" cy="28.1" r="1.7" fill="currentColor" opacity=".52" />
      <circle cx="18.2" cy="34.6" r="1.4" fill="currentColor" opacity=".35" />
      <circle cx="34.8" cy="15.8" r="6.2" stroke="currentColor" strokeWidth="1" opacity=".2" />
    </svg>
  );
}

export function EvidenceGlyph({ size = 52, className }: GlyphProps) {
  return (
    <svg
      className={`${styles.glyph} ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 52 52"
      fill="none"
      aria-hidden="true"
    >
      <path d="M14.5 13.5h16.8l6.2 6.2v18.8h-23z" stroke="currentColor" strokeWidth="1.35" />
      <path d="M31.3 13.5v6.2h6.2" stroke="currentColor" strokeWidth="1.35" />
      <path d="M20 25h11.5M20 30h8.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity=".56" />
      <circle cx="20" cy="35" r="2.1" fill="currentColor" />
      <path d="m24.5 35 2.2 2.1 5-5.2" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="38.5" cy="12.5" r="1.5" fill="currentColor" opacity=".36" />
    </svg>
  );
}

export function ActionGlyph({ size = 52, className }: GlyphProps) {
  return (
    <svg
      className={`${styles.glyph} ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 52 52"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="13" cy="38.5" r="2.7" fill="currentColor" />
      <circle cx="25.5" cy="27" r="1.8" fill="currentColor" opacity=".42" />
      <path d="M15.5 37c5.2-1.8 6-6.8 10-9.6 4.1-2.9 7.9-2.1 12.7-8.2" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeDasharray="2 3" />
      <path d="m32.7 17.6 7.3-.4-.6 7.2" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 45h24" stroke="currentColor" strokeWidth="1" opacity=".2" />
    </svg>
  );
}

export function ArrowGlyph({ size = 18, className }: GlyphProps) {
  return (
    <svg className={`${styles.glyph} ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12h14M13.5 6.5 19 12l-5.5 5.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DocumentGlyph({ size = 18, className }: GlyphProps) {
  return (
    <svg className={`${styles.glyph} ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9 12h6M9 15.5h4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".68" />
      <circle cx="9" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

export function RouteGlyph({ size = 18, className }: GlyphProps) {
  return (
    <svg className={`${styles.glyph} ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5" cy="18" r="2" fill="currentColor" />
      <circle cx="13" cy="10" r="1.3" fill="currentColor" opacity=".42" />
      <path d="M7 18c5.8 0 2.8-8 7.8-9.7 1.2-.4 2.5-.5 4.2-.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="2 2" />
      <path d="m16.3 4.8 3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusGlyph({ size = 16, className }: GlyphProps) {
  return (
    <svg className={`${styles.glyph} ${className ?? ""}`} width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/** Compatibility visualization without compass labels, a center point, or a rotating sweep. */
export function RadarField() {
  return (
    <svg
      className={styles.instrumentField}
      viewBox="0 0 760 760"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Поле сигналов: одна компания получила новый подтверждённый сигнал найма"
    >
      <defs>
        <radialGradient id="compat-instrument-wash" cx="52%" cy="48%" r="58%">
          <stop offset="0" stopColor="#7fd8bd" stopOpacity=".14" />
          <stop offset="1" stopColor="#101817" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="760" height="760" fill="url(#compat-instrument-wash)" />
      <g className={styles.instrumentRings} fill="none">
        <circle cx="380" cy="380" r="112" />
        <circle cx="380" cy="380" r="214" />
        <circle cx="380" cy="380" r="314" />
      </g>
      <g className={styles.instrumentQuietNodes}>
        <circle cx="246" cy="278" r="3" />
        <circle cx="548" cy="344" r="3" />
        <circle cx="236" cy="504" r="3" />
        <circle cx="478" cy="548" r="3" />
        <circle cx="324" cy="208" r="2.4" />
        <circle cx="590" cy="474" r="2.4" />
      </g>
      <g className={styles.instrumentActiveNode}>
        <circle cx="508" cy="238" r="4" />
        <circle cx="508" cy="238" r="25" />
        <circle cx="508" cy="238" r="46" />
      </g>
    </svg>
  );
}
