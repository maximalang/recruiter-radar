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
      if (!media.matches) setShowAll(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const rows = Children.toArray(children);
  const collapsed = mobileEnhanced && !showAll;
  const visibleRows = collapsed ? rows.slice(0, 3) : rows;
  const remaining = Math.max(0, rows.length - 3);

  return (
    <div className={styles.workspaceLeadList} data-mobile-lead-list data-expanded={showAll || undefined}>
      <div id="landing-preview-lead-rows">
        {visibleRows}
      </div>
      {mobileEnhanced && remaining > 0 ? (
        <button
          type="button"
          className={sceneStyles.leadDisclosure}
          data-mobile-lead-disclosure="true"
          aria-expanded={showAll}
          aria-controls="landing-preview-lead-rows"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "Скрыть дополнительные компании" : `Показать ещё ${remaining} компании`}
        </button>
      ) : null}
    </div>
  );
}
