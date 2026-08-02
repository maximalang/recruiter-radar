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
      role="img"
      aria-label="Сигнал"
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
      role="img"
      aria-label="Доказательство"
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
      role="img"
      aria-label="Действие"
    >
      <circle cx="10" cy="42" r="3" fill="currentColor" />
      <path d="M12 40 38 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m29 14 9-1 1 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="38" cy="14" r="7" stroke="currentColor" strokeWidth="1.3" opacity=".45" />
    </svg>
  );
}

export function RadarField() {
  return (
    <svg
      className={styles.radarField}
      viewBox="0 0 760 760"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Поле сигналов: одна компания получила новый сигнал найма"
    >
      <defs>
        <radialGradient id="radar-field-wash" cx="50%" cy="50%" r="58%">
          <stop offset="0" stopColor="#18324a" stopOpacity=".68" />
          <stop offset="1" stopColor="#0a121b" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="760" height="760" fill="url(#radar-field-wash)" />
      <g className={styles.radarRings} fill="none" stroke="currentColor">
        <circle cx="380" cy="380" r="112" />
        <circle cx="380" cy="380" r="212" />
        <circle cx="380" cy="380" r="316" />
      </g>
      <path className={styles.radarAxis} d="M64 380h632M380 64v632" />
      <path className={styles.radarAxis} d="M116 116 644 644M644 116 116 644" opacity=".25" />
      <g className={styles.radarQuietSignals}>
        <circle cx="246" cy="270" r="3" />
        <circle cx="562" cy="318" r="3" />
        <circle cx="208" cy="492" r="3" />
        <circle cx="516" cy="544" r="3" />
        <circle cx="438" cy="198" r="3" />
      </g>
      <g className={styles.radarActiveSignal}>
        <circle cx="492" cy="232" r="4" />
        <circle cx="492" cy="232" r="34" />
        <circle cx="492" cy="232" r="68" />
        <path d="M492 232 380 380" />
      </g>
    </svg>
  );
}
