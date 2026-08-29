"use client";

import { Children, type ReactNode, useEffect, useState } from "react";

import styles from "./landing.module.css";
import sceneStyles from "./workspace-scene.module.css";

const MOBILE_QUERY = "(max-width: 480px)";

export default function WorkspaceLeadList({ children }: { children: ReactNode }) {
  const [mobileEnhanced, setMobileEnhanced] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const sync = () => {
      setMobileEnhanced(media.matches);
      setShowAll(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const rows = Children.toArray(children);
  const defaultVisible = mobileEnhanced ? 2 : 4;
  const visibleRows = showAll ? rows : rows.slice(0, defaultVisible);
  const remaining = Math.max(0, rows.length - defaultVisible);

  return (
    <div className={styles.workspaceLeadList} data-mobile-lead-list data-expanded={showAll || undefined}>
      <div id="landing-preview-lead-rows">
        {visibleRows}
      </div>
      {remaining > 0 ? (
        <button
          type="button"
          className={sceneStyles.leadDisclosure}
          data-mobile-lead-disclosure={mobileEnhanced || undefined}
          data-lead-disclosure="true"
          aria-expanded={showAll}
          aria-controls="landing-preview-lead-rows"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "Скрыть дополнительные компании" : `Показать ещё ${remaining} ${remaining === 1 ? "компанию" : "компании"}`}
        </button>
      ) : null}
    </div>
  );
}
