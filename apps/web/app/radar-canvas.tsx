"use client";

import { useEffect, useRef } from "react";

import {
  LANDING_MOTION_EVENT,
  type LandingMotionDetail,
} from "./landing-motion/motion-preference";
import { useLandingMotion } from "./landing-motion/landing-motion-provider";
import { dispatchLandingRadarSignal } from "./landing-radar-signal";

/**
 * Background radar animation for the landing hero.
 *
 * Literal product metaphor: a sweeping radar that periodically "detects"
 * company dots and lights them up. Pure canvas — no video asset, no deps,
 * respects prefers-reduced-motion (static gradient when disabled), and
 * pauses when the tab is hidden.
 */
export default function RadarCanvas() {
  const initialMotion = useLandingMotion();
  const initialMotionRef = useRef(initialMotion);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = initialMotionRef.current.reduced;
    let userPaused = initialMotionRef.current.paused;
    let inViewport = true;

    let width = 0;
    let height = 0;
    let dpr = 1;

    type Blip = { angle: number; radius: number; lit: number; label: string };
    let blips: Blip[] = [];
    let sweep = 0;
    let lastSignalAt = 0;
    let signalIndex = 0;
    let rafId = 0;
    let running = true;

    const labels = [
      "HR-отдел",
      "карьерный сайт",
      "всплеск найма",
      "новый регион",
      "3 роли",
      "уровень доверия A",
      "2 источника",
    ];

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedBlips();
    }

    function seedBlips() {
      // Keep the origin geometrically centered. The canvas fills the hero, so
      // any vertical offset makes the outer range ring visibly clip unevenly.
      const cx = width / 2;
      const cy = height / 2;
      const maxR = Math.min(width, height) * 0.5;
      // Fewer blips than before — a focused radar shows a handful of
      // contacts, not a scatter of noise. Keep them in the mid/outer band so
      // the headline area reads clean and the contacts ring the text.
      const inner = maxR * 0.34;
      const count = Math.max(5, Math.round((width * height) / 68000));
      blips = Array.from({ length: count }, (_, i) => {
        const angle = Math.random() * Math.PI * 2;
        const radius = inner + Math.random() * (maxR - inner);
        return {
          angle,
          radius,
          lit: 0,
          label: labels[i % labels.length],
        };
      });
      // place origin relative to center for the sweep math
      cxRef.current = cx;
      cyRef.current = cy;
    }

    const cxRef = { current: 0 };
    const cyRef = { current: 0 };

    function drawStatic() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      // base radial wash — a soft glow centered on the radar origin so the
      // sweep reads as coming from a real focal point, not flat darkness.
      const g = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 1.3);
      g.addColorStop(0, "rgba(37, 99, 235, 0.14)");
      g.addColorStop(1, "rgba(15, 23, 42, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      drawRings(0.55);
      drawBlips(1);
    }

    function drawRings(alpha: number) {
      if (!ctx) return;
      const cx = cxRef.current;
      const cy = cyRef.current;
      const maxR = Math.min(width, height) * 0.46;
      // Concentric range rings — the radar's defining shape. Brighter than
      // before so the metaphor actually reads against the dark hero.
      ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        const r = (maxR * i) / 4;
        ctx.strokeStyle = `rgba(96, 165, 250, ${alpha * (0.22 + i * 0.04)})`;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Crosshair axes through the origin — completes the radar silhouette.
      ctx.strokeStyle = `rgba(96, 165, 250, ${alpha * 0.16})`;
      ctx.beginPath();
      ctx.moveTo(cx - maxR, cy);
      ctx.lineTo(cx + maxR, cy);
      ctx.moveTo(cx, cy - maxR);
      ctx.lineTo(cx, cy + maxR);
      ctx.stroke();
      // Center origin node
      ctx.fillStyle = `rgba(147, 197, 253, ${alpha * 0.5})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawBlips(litFloor: number) {
      if (!ctx) return;
      const cx = cxRef.current;
      const cy = cyRef.current;
      const showLabels = width >= 720;
      for (const b of blips) {
        const x = cx + Math.cos(b.angle) * b.radius;
        const y = cy + Math.sin(b.angle) * b.radius;
        const intensity = Math.max(litFloor, b.lit);
        // halo
        if (intensity > 0.05) {
          const halo = ctx.createRadialGradient(x, y, 0, x, y, 16);
          halo.addColorStop(0, `rgba(96, 165, 250, ${intensity * 0.85})`);
          halo.addColorStop(1, "rgba(96, 165, 250, 0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(x, y, 16, 0, Math.PI * 2);
          ctx.fill();
        }
        // core dot — brighter idle state so the radar looks populated, not empty
        ctx.fillStyle = `rgba(191, 219, 254, ${0.45 + intensity * 0.55})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        // label when freshly lit
        if (showLabels && b.lit > 0.5) {
          ctx.fillStyle = `rgba(219, 234, 254, ${b.lit})`;
          ctx.font = "600 11px Inter, system-ui, sans-serif";
          ctx.fillText(b.label, x + 8, y + 4);
        }
      }
    }

    function drawSweep() {
      if (!ctx) return;
      const cx = cxRef.current;
      const cy = cyRef.current;
      const maxR = Math.min(width, height) * 0.46;
      // Wider, brighter trailing sweep — the "scan" should be the most
      // visible moving element, a clear radial gradient from origin.
      const start = sweep - 0.62;
      const end = sweep;
      const grad = ctx.createLinearGradient(
        cx + Math.cos(start) * maxR,
        cy + Math.sin(start) * maxR,
        cx + Math.cos(end) * maxR,
        cy + Math.sin(end) * maxR,
      );
      grad.addColorStop(0, "rgba(96, 165, 250, 0)");
      grad.addColorStop(1, "rgba(96, 165, 250, 0.34)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxR, start, end);
      ctx.closePath();
      ctx.fill();
    }

    function frame() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      // Background wash shares the exact ring origin, preventing a second,
      // optically shifted center from appearing during the sweep.
      const g = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 1.3);
      g.addColorStop(0, "rgba(37, 99, 235, 0.14)");
      g.addColorStop(1, "rgba(15, 23, 42, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      drawRings(0.55);
      drawSweep();

      // advance sweep + light up blips in its path
      sweep += 0.018;
      if (sweep > Math.PI * 2) sweep -= Math.PI * 2;
      for (const b of blips) {
        let a = b.angle - sweep;
        a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        // blip is lit when the sweep just passed it (a small window)
        if (a < 0.08) {
          b.lit = 1;
          const now = performance.now();
          if (now - lastSignalAt >= 2_400) {
            dispatchLandingRadarSignal(signalIndex);
            signalIndex = (signalIndex + 1) % 3;
            lastSignalAt = now;
          }
        }
        b.lit *= 0.985;
      }
      drawBlips(0);

      if (running) rafId = requestAnimationFrame(frame);
    }

    function syncAnimation() {
      running = false;
      cancelAnimationFrame(rafId);
      const shouldAnimate =
        !reduceMotion && !userPaused && inViewport && !document.hidden;
      if (shouldAnimate) {
        running = true;
        rafId = requestAnimationFrame(frame);
      } else {
        drawStatic();
      }
    }

    function onVisibility() {
      syncAnimation();
    }

    function onMotionPreference(event: Event) {
      const detail = (event as CustomEvent<LandingMotionDetail>).detail;
      userPaused = detail?.paused ?? false;
      reduceMotion = detail?.reduced ?? motionMedia.matches;
      syncAnimation();
    }

    function onReducedMotionChange() {
      reduceMotion = motionMedia.matches;
      syncAnimation();
    }

    resize();
    syncAnimation();
    const onResize = () => {
      resize();
      if (!running) drawStatic();
    };
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inViewport = entry?.isIntersecting ?? true;
      syncAnimation();
    }, { rootMargin: "120px" });
    intersectionObserver.observe(canvas);

    window.addEventListener("resize", onResize);
    window.addEventListener(LANDING_MOTION_EVENT, onMotionPreference);
    motionMedia.addEventListener("change", onReducedMotionChange);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      intersectionObserver.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener(LANDING_MOTION_EVENT, onMotionPreference);
      motionMedia.removeEventListener("change", onReducedMotionChange);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
