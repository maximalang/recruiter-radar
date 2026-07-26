import { getLandingProductProof } from "../lib/landing-product-proof";
import hpStyles from "./home-page-components.module.css";

const integerFormatter = new Intl.NumberFormat("ru-RU");
const timestampFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

export default async function LandingProductProof() {
  const proof = await getLandingProductProof();
  if (!proof) return null;

  return (
    <section
      id="product-proof"
      className={hpStyles.productProof}
      aria-labelledby="product-proof-title"
      data-product-proof
      data-scroll-anchor
    >
      <div className={hpStyles.productProofHeader}>
        <span>Реальные агрегаты · без персональных данных</span>
        <h2 id="product-proof-title">Что радар проверяет сейчас</h2>
      </div>
      <dl className={hpStyles.productProofMetrics}>
        <div>
          <dt>Компаний с сигналами найма за 7 дней</dt>
          <dd>{integerFormatter.format(proof.companiesWithHiringSignals7d)}</dd>
        </div>
        <div>
          <dt>Подтверждённых сигналов найма</dt>
          <dd>{integerFormatter.format(proof.confirmedHiringSignals7d)}</dd>
        </div>
        <div>
          <dt>Компаний, прошедших уровень доверия A/B</dt>
          <dd>{integerFormatter.format(proof.companiesPassingConfidenceGate7d)}</dd>
        </div>
        <div>
          <dt>Последний успешный пересчёт</dt>
          <dd>
            <time dateTime={proof.lastSuccessfulRecalculationAt}>
              {timestampFormatter.format(new Date(proof.lastSuccessfulRecalculationAt))}
            </time>
            <span>мск</span>
          </dd>
        </div>
      </dl>
      <p className={hpStyles.productProofNote}>
        Подтверждённый сигнал — сигнал найма компании, которая прошла уровень
        доверия A или B в завершённом пересчёте за последние 7 дней.
      </p>
    </section>
  );
}

export function LandingProductProofSkeleton() {
  return (
    <div
      className={`${hpStyles.productProof} ${hpStyles.productProofSkeleton}`}
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
    </div>
  );
}
