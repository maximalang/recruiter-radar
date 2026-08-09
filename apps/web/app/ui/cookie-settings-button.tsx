"use client";

import { ANALYTICS_SETTINGS_OPEN_EVENT } from "../../lib/analytics-consent";
import s from "./site-footer.module.css";

export function CookieSettingsButton() {
  return (
    <button
      type="button"
      className={`${s.footerLink} ${s.footerButton}`}
      onClick={() => window.dispatchEvent(new Event(ANALYTICS_SETTINGS_OPEN_EVENT))}
    >
      Настройки cookies
    </button>
  );
}
