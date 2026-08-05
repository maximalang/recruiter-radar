import styles from "./landing.module.css";

type HeroInstrumentProps = {
  companyName: string;
  signalLabel: string;
  score: number;
  confidence: string;
  freshness: string;
};

/**
 * Replaceable hero visualization boundary.
 * The surrounding hero only passes product facts, so a future Evidence Instrument
 * can replace this temporary signal field without changing DetectionScene.
 */
export default function HeroInstrument({
  companyName,
  signalLabel,
  score,
  confidence,
  freshness,
}: HeroInstrumentProps) {
  return (
    <figure className={styles.heroInstrument} aria-label={`Инструмент доказательств для ${companyName}`}>
      <svg
        className={styles.instrumentField}
        viewBox="0 0 760 760"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${signalLabel}. Оценка ${score} из 100, уровень уверенности ${confidence}.`}
      >
        <defs>
          <radialGradient id="instrument-wash" cx="52%" cy="48%" r="58%">
            <stop offset="0" stopColor="#6fae9c" stopOpacity=".16" />
            <stop offset=".55" stopColor="#223846" stopOpacity=".1" />
            <stop offset="1" stopColor="#17232d" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="instrument-link" x1="180" y1="520" x2="560" y2="210" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6fae9c" stopOpacity=".18" />
            <stop offset="1" stopColor="#9bcbbb" stopOpacity=".72" />
          </linearGradient>
        </defs>
        <rect width="760" height="760" fill="url(#instrument-wash)" />
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
        <path className={styles.instrumentConnection} d="M380 380 508 238" />
        <g className={styles.instrumentQuietNodes}>
          <circle cx="246" cy="278" r="4" />
          <circle cx="548" cy="344" r="4" />
          <circle cx="236" cy="504" r="4" />
          <circle cx="478" cy="548" r="4" />
        </g>
        <g className={styles.instrumentActiveNode}>
          <circle cx="508" cy="238" r="5" />
          <circle cx="508" cy="238" r="30" />
          <circle cx="508" cy="238" r="58" />
        </g>
        <g className={styles.instrumentCore}>
          <circle cx="380" cy="380" r="7" />
          <circle cx="380" cy="380" r="24" />
        </g>
      </svg>

      <figcaption className={styles.instrumentCaption}>
        <span>Инструмент доказательств / временная композиция</span>
        <div>
          <strong>{signalLabel}</strong>
          <small>{freshness} · уверенность {confidence}</small>
        </div>
        <b>{score}<small>/100</small></b>
      </figcaption>
    </figure>
  );
}
