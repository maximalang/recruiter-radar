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
      <circle cx="26" cy="26" r="3.5" fill="currentColor" />
      <circle cx="26" cy="26" r="12" stroke="currentColor" strokeWidth="1.5" opacity=".55" />
      <path d="M26 7v6M45 26h-6M26 45v-6M7 26h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".3" />
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
      <circle cx="26" cy="26" r="4" fill="currentColor" />
      <circle cx="26" cy="26" r="12" stroke="currentColor" strokeWidth="1.5" opacity=".8" />
      <circle cx="26" cy="26" r="20" stroke="currentColor" strokeWidth="1.5" opacity=".35" />
      <path d="M26 6v8M46 26h-8M26 46v-8M6 26h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".45" />
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
      <circle cx="10" cy="42" r="3" fill="currentColor" />
      <path d="M12 40 38 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m29 14 9-1 1 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="38" cy="14" r="7" stroke="currentColor" strokeWidth="1.3" opacity=".45" />
    </svg>
  );
}

export function ArrowGlyph({ size = 18, className }: GlyphProps) {
  return (
    <svg className={`${styles.glyph} ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

export function DocumentGlyph({ size = 18, className }: GlyphProps) {
  return (
    <svg className={`${styles.glyph} ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4M9 12h6M9 15.5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
    </svg>
  );
}

export function RouteGlyph({ size = 18, className }: GlyphProps) {
  return (
    <svg className={`${styles.glyph} ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5" cy="18" r="2" fill="currentColor" />
      <path d="M7 18c7 0 3-11 10-11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" strokeDasharray="2 2" />
      <path d="m16 4 3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
    </svg>
  );
}

export function PlusGlyph({ size = 16, className }: GlyphProps) {
  return (
    <svg className={`${styles.glyph} ${className ?? ""}`} width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="square" />
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
          <stop offset="0" stopColor="#6fae9c" stopOpacity=".16" />
          <stop offset="1" stopColor="#17232d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="760" height="760" fill="url(#compat-instrument-wash)" />
      <g className={styles.instrumentRings} fill="none">
        <circle cx="380" cy="380" r="112" />
        <circle cx="380" cy="380" r="214" />
        <circle cx="380" cy="380" r="314" />
      </g>
      <g className={styles.instrumentGuides} fill="none">
        <path d="M120 380h520" />
        <path d="M380 120v520" />
        <path d="M198 562 562 198" />
      </g>
      <g className={styles.instrumentQuietNodes}>
        <circle cx="246" cy="278" r="4" />
        <circle cx="548" cy="344" r="4" />
        <circle cx="236" cy="504" r="4" />
        <circle cx="478" cy="548" r="4" />
        <circle cx="324" cy="208" r="3" />
        <circle cx="590" cy="474" r="3" />
      </g>
      <g className={styles.instrumentActiveNode}>
        <circle cx="508" cy="238" r="5" />
        <circle cx="508" cy="238" r="30" />
        <circle cx="508" cy="238" r="58" />
      </g>
    </svg>
  );
}
