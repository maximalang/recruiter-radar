"use client";

import { useEffect, useRef } from "react";

import styles from "./hero-signal-field.module.css";

const SIGNAL_CLUSTERS = [
  {
    id: "career",
    x: 69,
    y: 30,
    eyebrow: "СВЕЖИЙ СИГНАЛ",
    company: "Промышленная группа",
    label: "Инженерный найм ускорился",
    meta: "3 подтверждения · сегодня",
    active: true,
  },
  { id: "vacancies", x: 38, y: 35, label: "новые роли", meta: "8 позиций" },
  { id: "repeat", x: 48, y: 68, label: "повтор", meta: "3 роли снова открыты" },
  { id: "leadership", x: 78, y: 58, label: "усиление", meta: "руководитель направления" },
] as const;

export default function HeroSignalField() {
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
  }, []);

  const schedulePointer = (clientX: number, clientY: number) => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.matchMedia("(pointer: coarse)").matches) return;
    const rect = root.getBoundingClientRect();
    pointerRef.current = {
      x: Math.max(-1, Math.min(1, ((clientX - rect.left) / rect.width - 0.5) * 2)),
      y: Math.max(-1, Math.min(1, ((clientY - rect.top) / rect.height - 0.5) * 2)),
    };
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const nextRoot = rootRef.current;
      if (!nextRoot) return;
      nextRoot.style.setProperty("--field-x", pointerRef.current.x.toFixed(3));
      nextRoot.style.setProperty("--field-y", pointerRef.current.y.toFixed(3));
    });
  };

  const resetPointer = () => {
    const root = rootRef.current;
    if (!root) return;
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    root.style.setProperty("--field-x", "0");
    root.style.setProperty("--field-y", "0");
  };

  return (
    <div
      ref={rootRef}
      className={styles.fieldRoot}
      data-hero-signal-field="ambient"
      onPointerMove={(event) => {
        if (event.pointerType === "mouse") schedulePointer(event.clientX, event.clientY);
      }}
      onPointerLeave={resetPointer}
    >
      <svg className={styles.field} viewBox="0 0 760 760" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="hero-signal-wash" cx="58%" cy="42%" r="62%">
            <stop className={styles.washSignal} offset="0" />
            <stop className={styles.washMid} offset=".55" />
            <stop className={styles.washEdge} offset="1" />
          </radialGradient>
        </defs>
        <rect width="760" height="760" fill="url(#hero-signal-wash)" />

        <g className={styles.ringLayer}>
          <circle cx="380" cy="380" r="314" />
          <circle cx="380" cy="380" r="248" />
          <circle cx="380" cy="380" r="176" />
          <circle cx="380" cy="380" r="108" />
        </g>
        <g className={styles.arcLayer}>
          <path d="M159 158a314 314 0 0 1 122-77" />
          <path d="M575 123a314 314 0 0 1 111 139" />
          <path d="M679 481a314 314 0 0 1-87 137" />
          <path d="M207 651a314 314 0 0 1-112-143" />
        </g>
        <g className={styles.tickLayer}>
          <path d="M380 58v13M442 64l-3 12M503 83l-5 11M654 192l-11 7M692 318l-13 2M687 451l-13-3M604 604l-9-10M456 691l-3-13M300 688l3-13M158 611l9-10M76 471l13-3M69 329l13 2M130 207l11 7M247 92l5 11" />
        </g>
        <g className={styles.labelLayer}>
          <text x="397" y="63">N-04</text>
          <text x="637" y="190">E-12</text>
          <text x="642" y="537">Q-08</text>
          <text x="126" y="593">W-03</text>
          <text x="101" y="242">SRC/7</text>
        </g>
        <g className={styles.ambientLayer}>
          {[
            [154, 337], [205, 207], [286, 130], [353, 177], [458, 145], [611, 292], [645, 406],
            [586, 525], [507, 611], [345, 638], [232, 585], [129, 465], [287, 339], [438, 430], [520, 355],
          ].map(([cx, cy], index) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={index % 4 === 0 ? 1.5 : 1} />)}
        </g>
        <g className={styles.linkLayer}>
          <path d="M274 252 290 240 303 260 319 270" />
          <path d="M355 521 374 507 392 525 411 536" />
          <path d="M514 223 535 208 553 226 570 242" />
          <path d="M579 438 599 425 617 447 635 459" />
        </g>
        <g className={styles.clusterLayer}>
          <g transform="translate(274 252)"><circle r="3.2" /><circle cx="16" cy="-12" r="1.8" /><circle cx="29" cy="8" r="2.2" /><circle cx="45" cy="18" r="1.4" /></g>
          <g transform="translate(355 521)"><circle r="2.7" /><circle cx="19" cy="-14" r="1.6" /><circle cx="37" cy="4" r="2" /><circle cx="56" cy="15" r="1.4" className={styles.copperDot} /></g>
          <g transform="translate(579 438)"><circle r="2.8" /><circle cx="20" cy="-13" r="1.5" /><circle cx="38" cy="9" r="2.1" /><circle cx="56" cy="21" r="1.5" /></g>
        </g>
        <g className={styles.activeLayer}>
          <circle className={styles.activeHalo} r="46" />
          <circle className={styles.activeCore} r="4.6" />
          <circle cx="15" cy="-12" r="2.1" /><circle cx="31" cy="3" r="1.8" /><circle cx="40" cy="19" r="2.4" />
          <circle cx="7" cy="22" r="1.6" className={styles.copperDot} /><circle cx="-15" cy="11" r="1.4" />
        </g>
      </svg>

      <div className={styles.clusterTargets} aria-label="Примеры сигналов на радаре">
        {SIGNAL_CLUSTERS.map((cluster) => (
          <span
            key={cluster.id}
            role="note"
            tabIndex={0}
            className={styles.clusterTarget}
            style={{ left: `${cluster.x}%`, top: `${cluster.y}%` }}
            data-active={("active" in cluster && cluster.active) || undefined}
            aria-label={"company" in cluster
              ? `${cluster.eyebrow}. ${cluster.company}. ${cluster.label}: ${cluster.meta}`
              : `${cluster.label}: ${cluster.meta}`}
          >
            <span className={styles.targetDot} aria-hidden="true" />
            <span className={styles.microLabel} aria-hidden="true">
              {"eyebrow" in cluster ? <small>{cluster.eyebrow}</small> : null}
              {"company" in cluster ? <b>{cluster.company}</b> : null}
              <strong>{cluster.label}</strong>
              <small>{cluster.meta}</small>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
