import hpStyles from "./home-page-components.module.css";

export default function LandingDeliveryDemo() {
  return (
    <article className={`${hpStyles.deliveryCard} ${hpStyles.deliveryDemo}`}>
      <div className={hpStyles.deliveryTopbar}>
        <span className={hpStyles.deliveryMark} aria-hidden="true">RR</span>
        <div>
          <strong>Доставка результата</strong>
          <span>основной канал пилота — Telegram</span>
        </div>
      </div>

      <div className={hpStyles.deliveryPanel} aria-label="Пример утреннего радара в Telegram">
        <div className={hpStyles.botPreview}>
          <span>Утренний радар · короткий список</span>
          <h3>Начните с этого сигнала</h3>
          <p><strong>Производственная компания</strong> усилила инженерный найм. В карточке есть подтверждающие факты, оценка уверенности и корпоративный путь контакта.</p>
        </div>
      </div>

      <div className={hpStyles.feedbackDemo}>
        <span className={hpStyles.feedbackLabel}>Что получает команда</span>
        <p className={hpStyles.feedbackStatus}>
          Приоритет компаний, объяснение «почему сейчас», ограничения сигнала и следующий шаг для ручной работы BD.
        </p>
      </div>

      <p className={hpStyles.deliveryNote}>
        Recruiter Radar не отправляет сообщения компаниям автоматически. Дополнительные каналы подключаются только после проверки их доступности для конкретного тарифа.
      </p>
    </article>
  );
}
