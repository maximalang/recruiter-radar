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
      <path d="M12.5 28.8a14.8 14.8 0 0 1 4.3-11.2M22.1 12.2a14.8 14.8 0 0 1 13.7 3.4M39.2 21.1a14.8 14.8 0 0 1-1.8 13.6M31.8 39.6a14.8 14.8 0 0 1-12.9-1.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      <path d="M31.3 15.1 36 15.6l-.8 4.6M14.6 33l-2.1-4.2 4.5-1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity=".48" />
      <circle cx="36.1" cy="18.7" r="2.45" fill="currentColor" />
      <circle cx="38.2" cy="31.4" r="1.55" fill="currentColor" opacity=".54" />
      <circle cx="18.6" cy="37" r="1.25" fill="currentColor" opacity=".4" />
      <path d="m31.7 20.9 4.4-2.2 2.1 12.7" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 3" opacity=".34" />
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
      <path d="M15 14.2h17.1l5 5v18.6H15z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M32.1 14.2v5h5" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M20.3 24.2h11.4M20.3 29h8.6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity=".56" />
      <path d="m20.5 34.2 2.3 2.2 5-5.2" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="36.8" cy="35.4" r="2.1" fill="currentColor" opacity=".42" />
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
      <path d="M6.2 3.8h7.7l3.9 3.9v12.5H6.2z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M13.9 3.8v3.9h3.9" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M9 11.6h6M9 15h4.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".62" />
      <circle cx="9" cy="8.2" r=".9" fill="currentColor" />
    </svg>
  );
}

export function RouteGlyph({ size = 18, className }: GlyphProps) {
  return (
    <svg className={`${styles.glyph} ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5.2" cy="17.7" r="1.8" fill="currentColor" />
      <circle cx="13" cy="10.2" r="1.2" fill="currentColor" opacity=".46" />
      <path d="M7 17.7c4.7-.3 3.2-5.9 6.1-7.3 1.7-.9 3.7-.8 5.7-2.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeDasharray="1.7 2.6" />
      <path d="m16.1 5.7 3 2.1-2.2 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
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
        <radialGradient id="compat-instrument-wash" cx="57%" cy="42%" r="58%">
          <stop offset="0" stopColor="#7fd8bd" stopOpacity=".12" />
          <stop offset="1" stopColor="#101817" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="760" height="760" fill="url(#compat-instrument-wash)" />
      <g className={styles.instrumentRings} fill="none">
        <circle cx="380" cy="380" r="118" />
        <circle cx="380" cy="380" r="218" />
        <circle cx="380" cy="380" r="302" />
      </g>
      <g className={styles.instrumentQuietNodes}>
        <circle cx="246" cy="278" r="2" />
        <circle cx="548" cy="244" r="3.4" />
        <circle cx="236" cy="504" r="1.8" />
        <circle cx="478" cy="548" r="2" />
        <circle cx="324" cy="208" r="1.4" />
        <circle cx="590" cy="474" r="1.6" />
      </g>
    </svg>
  );
}
