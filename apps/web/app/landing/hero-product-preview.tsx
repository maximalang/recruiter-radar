import { ArrowGlyph } from "./brand-glyphs";
import sceneStyles from "./detection-scene.module.css";

/**
 * Static, clearly-labeled illustrative panel for the hero (concept 2):
 * "dark + product screen". Deliberately NOT real-time data — every claim is
 * demo-marked, no freshness/production proof. Server component: zero JS cost.
 */
export default function HeroProductPreview() {
  return (
    <div
      className={sceneStyles.productShot}
      data-hero-product-preview="demo"
      role="img"
      aria-label="Пример карточки компании из утреннего списка: повод для контакта, подтверждающие факты и официальный путь контакта. Демо-данные."
    >
      <div className={sceneStyles.shotBar} aria-hidden="true">
        <span className={sceneStyles.shotDot} />
        <span className={sceneStyles.shotDot} />
        <span className={sceneStyles.shotDot} />
        <span className={sceneStyles.shotTitle}>Recruiter Radar</span>
        <span className={sceneStyles.shotDemoTag}>Демо-данные</span>
      </div>
      <div className={sceneStyles.shotBody}>
        <div className={sceneStyles.shotSide} aria-hidden="true">
          <span className={sceneStyles.shotSideActive}>Сегодняшний список</span>
          <span>Инженерный подбор · Москва</span>
          <span>10 компаний с поводами</span>
          <span className={sceneStyles.shotSideNote}>Демо-данные</span>
        </div>
        <div className={sceneStyles.shotContent}>
          <p className={sceneStyles.shotTag}>Повод для обращения · демо-данные</p>
          <p className={sceneStyles.shotCompany}>Производственная компания «Промет»</p>
          <dl className={sceneStyles.shotTable}>
            <div className={sceneStyles.shotRow}>
              <dt>Факт</dt>
              <dd>Открыли 14 инженерных вакансий за последние дни</dd>
            </div>
            <div className={sceneStyles.shotRow}>
              <dt>Подтверждение</dt>
              <dd>Расширение производства упомянуто на карьерной странице</dd>
            </div>
            <div className={sceneStyles.shotRow}>
              <dt>Уверенность</dt>
              <dd>
                Высокая<span className={sceneStyles.shotDemoNote}>демо-данные</span>
              </dd>
            </div>
            <div className={sceneStyles.shotRow}>
              <dt>Контакт</dt>
              <dd>Официальная страница вакансий компании</dd>
            </div>
          </dl>
          <p className={sceneStyles.shotNext}>
            Готовое основание для первого письма руководителю найма
          </p>
        </div>
      </div>
    </div>
  );
}
