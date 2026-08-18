export type RadarOperationalStateProps = {
  profile: string;
  evidenceFreshness: string;
  sources: string;
  delivery: string;
  lastSync: string;
};

export function RadarOperationalState(props: RadarOperationalStateProps) {
  return (
    <section aria-label="Состояние радара">
      <dl>
        <div><dt>Профиль</dt><dd>{props.profile}</dd></div>
        <div><dt>Свежесть доказательств</dt><dd>{props.evidenceFreshness}</dd></div>
        <div><dt>Источники</dt><dd>{props.sources}</dd></div>
        <div><dt>Доставка</dt><dd>{props.delivery}</dd></div>
        <div><dt>Последняя синхронизация</dt><dd>{props.lastSync}</dd></div>
      </dl>
    </section>
  );
}
