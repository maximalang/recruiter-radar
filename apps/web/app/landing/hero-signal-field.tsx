"use client";

import { useEffect, useRef } from "react";

import { DEFAULT_LANDING_DEMO_STORY } from "../../lib/landing-demo";

import styles from "./hero-signal-field.module.css";

/* Abstract signal field, not a literal radar: three structural curves,
 * a quiet orbit line, eight sparse points, evidence relationships and one
 * dominant confirmed signal composed around an offset focal point.
 * Facts come from the canonical demo story — nothing is hardcoded here.
 * The figure is decorative: aria-hidden, no keyboard stops, no tooltips. */

const STORY = DEFAULT_LANDING_DEMO_STORY;

function pluralForm(count: number, forms: readonly [string, string, string]) {
  const tens = count % 10;
  const hundreds = count % 100;
  if (tens === 1 && hundreds !== 11) return forms[0];
  if (tens >= 2 && tens <= 4 && (hundreds < 10 || hundreds >= 20)) return forms[1];
  return forms[2];
}

const evidenceCount = STORY.evidence.length;
const dominantMeta = `${evidenceCount} ${pluralForm(evidenceCount, ["подтверждение", "подтверждения", "подтверждений"])} · ${STORY.company.freshness}`;
const supportingFact = STORY.company.change.split(" и ")[0];

export default function HeroSignalField() {
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
  }, []);

  /* Optional depth cue: pointer drift shifts layers by at most ~3px.
   * Disabled for reduced motion and coarse pointers; never loops. */
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
      aria-hidden="true"
      onPointerMove={(event) => {
        if (event.pointerType === "mouse") schedulePointer(event.clientX, event.clientY);
      }}
      onPointerLeave={resetPointer}
    >
      <svg className={styles.field} viewBox="0 0 760 760" focusable="false">
        <defs>
          <radialGradient id="hero-field-wash" cx="61%" cy="37%" r="58%">
            <stop className={styles.washSignal} offset="0" />
            <stop className={styles.washMid} offset=".55" />
            <stop className={styles.washEdge} offset="1" />
          </radialGradient>
          <radialGradient id="hero-field-copper-wash" cx="20%" cy="80%" r="52%">
            <stop className={styles.washCopper} offset="0" />
            <stop className={styles.washEdge} offset="1" />
          </radialGradient>
          <radialGradient id="hero-focus-halo" cx="50%" cy="50%" r="50%">
            <stop className={styles.haloCore} offset="0" />
            <stop className={styles.haloMid} offset=".62" />
            <stop className={styles.haloEdge} offset="1" />
          </radialGradient>
        </defs>

        <rect width="760" height="760" fill="url(#hero-field-wash)" />
        <rect width="760" height="760" fill="url(#hero-field-copper-wash)" />

        <g className={styles.structureLayer}>
          {/* Two partial arcs — deliberately incomplete so the field feels
           * larger than the viewport instead of framed like a dial. */}
          <circle className={styles.structArcA} cx="508" cy="322" r="316" pathLength={100} />
          <circle className={styles.structArcB} cx="436" cy="398" r="218" pathLength={100} />
          {/* One shallow trajectory crossing the field through the signal. */}
          <ellipse
            className={styles.orbitLine}
            cx="446"
            cy="322"
            rx="350"
            ry="148"
            pathLength={100}
            transform="rotate(-14 446 322)"
          />
        </g>

        <g className={styles.pointLayers}>
          <g className={styles.linkLayer}>
            <path className={styles.linkSolid} d="M300 208 402 252" />
            <path className={styles.linkDashed} d="M560 448 494 322" />
            <path className={styles.linkDashed} d="M368 466 432 334" />
          </g>
          <g className={styles.pointLayer}>
            <circle cx="236" cy="300" r="1.2" />
            <circle cx="300" cy="208" r="1.6" />
            <circle cx="420" cy="140" r="1.1" />
            <circle className={styles.copperPoint} cx="618" cy="196" r="1.4" />
            <circle cx="652" cy="392" r="1.1" />
            <circle cx="560" cy="448" r="1.5" />
            <circle cx="368" cy="466" r="1.3" />
            <circle cx="472" cy="532" r="1" />
          </g>
        </g>

        <g transform="translate(458 278)">
          <g className={styles.focusLayer}>
            <circle className={styles.focusHalo} r="56" />
            <circle className={styles.focusRing} r="44" />
            <circle className={styles.focusInnerRing} r="29" />
            <path className={styles.focusLinks} d="M0 0 18 -13M0 0 -21 7M0 0 7 23" />
            <circle cx="18" cy="-13" r="1.9" />
            <circle className={styles.copperPoint} cx="-21" cy="7" r="1.5" />
            <circle cx="7" cy="23" r="1.6" />
            <circle className={styles.focusCore} r="4.5" />
          </g>
        </g>
      </svg>

      {/* Two annotations maximum: one dominant, one whisper-quiet. */}
      <div className={styles.annotation}>
        <small className={styles.annotationEyebrow}>Свежий сигнал</small>
        <strong className={styles.annotationCompany}>{STORY.company.name}</strong>
        <span className={styles.annotationLine}>{STORY.company.signal}</span>
        <small className={styles.annotationMeta}>{dominantMeta}</small>
      </div>
      <div className={styles.whisper}>{supportingFact}</div>
    </div>
  );
}
