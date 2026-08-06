import styles from "./landing.module.css";

type HeroInstrumentProps = {
  companyName: string;
  signalLabel: string;
  score: number;
  confidence: string;
  freshness: string;
};

/** Replaceable hero visualization boundary fed only by product facts. */
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

      <figcaption className={styles.instrumentCaption}>
        <span>Подтверждённый сигнал / текущий приоритет</span>
        <div>
          <strong>{signalLabel}</strong>
          <small>{freshness} · уверенность {confidence}</small>
        </div>
        <b>{score}<small>/100</small></b>
      </figcaption>
    </figure>
  );
}
