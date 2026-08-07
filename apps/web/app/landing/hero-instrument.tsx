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
    <figure
      className={styles.heroInstrument}
      aria-label={`Инструмент доказательств для ${companyName}`}
      data-hero-instrument="true"
    >
      <svg
        className={styles.instrumentField}
        viewBox="0 0 760 760"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${signalLabel}. Оценка ${score} из 100, уровень уверенности ${confidence}.`}
      >
        <defs>
          <radialGradient id="instrument-wash" cx="52%" cy="48%" r="58%">
            <stop offset="0" stopColor="#7fd8bd" stopOpacity=".1" />
            <stop offset=".58" stopColor="#15201e" stopOpacity=".07" />
            <stop offset="1" stopColor="#09100f" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="760" height="760" fill="url(#instrument-wash)" />

        <g className={styles.instrumentRings} fill="none" aria-hidden="true">
          <circle cx="380" cy="380" r="112" />
          <circle cx="380" cy="380" r="214" />
          <circle cx="380" cy="380" r="314" />
        </g>

        <g
          className={styles.instrumentQuietNodes}
          aria-hidden="true"
          data-signal-cluster="primary"
        >
          <circle cx="218" cy="258" r="2" opacity=".28" data-signal-speck="early" />
          <circle cx="229" cy="269" r="3.2" opacity=".64" />
          <circle cx="244" cy="281" r="2.4" opacity=".48" data-signal-speck="late" />
          <circle cx="253" cy="260" r="1.7" opacity=".34" />
          <circle cx="266" cy="276" r="1.9" opacity=".3" />
          <circle cx="532" cy="337" r="2" opacity=".34" />
          <circle cx="544" cy="348" r="3.4" opacity=".62" data-signal-speck="late" />
          <circle cx="558" cy="356" r="2.2" opacity=".43" />
          <circle cx="571" cy="342" r="1.8" opacity=".28" data-signal-speck="early" />
        </g>

        <g
          aria-hidden="true"
          data-signal-cluster="secondary"
          fill="var(--copper)"
        >
          <circle cx="218" cy="493" r="1.7" opacity=".28" />
          <circle cx="230" cy="505" r="2.5" opacity=".48" data-signal-speck="late" />
          <circle cx="244" cy="516" r="1.8" opacity=".32" />
          <circle cx="463" cy="552" r="1.8" opacity=".28" />
          <circle cx="477" cy="544" r="2.8" opacity=".5" data-signal-speck="early" />
          <circle cx="491" cy="535" r="1.7" opacity=".32" />
          <circle cx="309" cy="203" r="1.7" opacity=".26" />
          <circle cx="321" cy="210" r="2.4" opacity=".42" data-signal-speck="late" />
          <circle cx="333" cy="218" r="1.5" opacity=".26" />
        </g>

        <g aria-hidden="true" fill="none" opacity=".42">
          <path d="M203 248c22-16 49-15 72 2" stroke="var(--signal)" strokeWidth="1" strokeDasharray="2 8" />
          <path d="M520 326c22-8 43-3 61 12" stroke="var(--signal)" strokeWidth="1" strokeDasharray="2 9" />
          <path d="M207 484c19-10 38-7 54 8" stroke="var(--copper)" strokeWidth="1" strokeDasharray="2 9" />
          <path d="M451 565c22 5 42-2 58-19" stroke="var(--copper)" strokeWidth="1" strokeDasharray="2 9" />
        </g>

        <g
          className={styles.instrumentActiveNode}
          aria-hidden="true"
          data-active-signal="true"
        >
          <circle cx="508" cy="238" r="4.5" />
          <circle cx="508" cy="238" r="24" />
          <circle cx="508" cy="238" r="44" />
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
