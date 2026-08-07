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
            <stop offset="0" stopColor="#9fca63" stopOpacity=".055" />
            <stop offset=".58" stopColor="#151d18" stopOpacity=".045" />
            <stop offset="1" stopColor="#080c0a" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="760" height="760" fill="url(#instrument-wash)" />

        <g
          className={styles.instrumentRings}
          fill="none"
          aria-hidden="true"
          data-radar-rings="true"
        >
          <circle cx="380" cy="380" r="112" />
          <circle cx="380" cy="380" r="214" />
          <circle cx="380" cy="380" r="314" />
        </g>

        <g
          className={styles.instrumentQuietNodes}
          aria-hidden="true"
          data-signal-cluster="primary"
        >
          <circle cx="218" cy="258" r="1.6" opacity=".26" data-signal-speck="early" />
          <circle cx="229" cy="269" r="2.6" opacity=".6" />
          <circle cx="244" cy="281" r="1.9" opacity=".44" data-signal-speck="late" />
          <circle cx="253" cy="260" r="1.4" opacity=".3" />
          <circle cx="266" cy="276" r="1.5" opacity=".28" />
          <circle cx="532" cy="337" r="1.5" opacity=".3" />
          <circle cx="544" cy="348" r="2.7" opacity=".58" data-signal-speck="late" />
          <circle cx="558" cy="356" r="1.7" opacity=".4" />
          <circle cx="571" cy="342" r="1.4" opacity=".26" data-signal-speck="early" />
        </g>

        <g
          aria-hidden="true"
          data-signal-cluster="secondary"
          fill="var(--copper)"
        >
          <circle cx="218" cy="493" r="1.3" opacity=".25" />
          <circle cx="230" cy="505" r="2" opacity=".44" data-signal-speck="late" />
          <circle cx="244" cy="516" r="1.4" opacity=".29" />
          <circle cx="463" cy="552" r="1.4" opacity=".25" />
          <circle cx="477" cy="544" r="2.2" opacity=".46" data-signal-speck="early" />
          <circle cx="491" cy="535" r="1.3" opacity=".29" />
          <circle cx="309" cy="203" r="1.3" opacity=".23" />
          <circle cx="321" cy="210" r="1.9" opacity=".39" data-signal-speck="late" />
          <circle cx="333" cy="218" r="1.2" opacity=".23" />
        </g>

        <g aria-hidden="true" fill="none" data-signal-links="true">
          <path d="M203 248c22-16 49-15 72 2" stroke="var(--signal)" strokeWidth=".7" strokeDasharray="1 10" />
          <path d="M520 326c22-8 43-3 61 12" stroke="var(--signal)" strokeWidth=".7" strokeDasharray="1 11" />
          <path d="M207 484c19-10 38-7 54 8" stroke="var(--copper)" strokeWidth=".7" strokeDasharray="1 11" />
          <path d="M451 565c22 5 42-2 58-19" stroke="var(--copper)" strokeWidth=".7" strokeDasharray="1 11" />
        </g>

        <g aria-hidden="true" data-active-signal="true">
          <circle cx="508" cy="238" r="3.2" />
          <circle cx="499" cy="230" r="1.35" opacity=".56" />
          <circle cx="516" cy="228" r="1.8" opacity=".72" />
          <circle cx="522" cy="242" r="1.25" opacity=".48" data-tone="secondary" />
          <circle cx="503" cy="250" r="1.55" opacity=".62" />
          <circle cx="515" cy="254" r="1.1" opacity=".42" data-tone="secondary" />
          <circle cx="491" cy="240" r="1.05" opacity=".36" />
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
