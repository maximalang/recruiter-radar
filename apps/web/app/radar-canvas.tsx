"use client";

import { useEffect, useRef } from "react";

/**
 * Background radar animation for the landing hero.
 *
 * Literal product metaphor: a sweeping radar that periodically "detects"
 * company dots and lights them up. Pure canvas — no video asset, no deps,
 * respects prefers-reduced-motion (static gradient when disabled), and
 * pauses when the tab is hidden.
 */
export default function RadarCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;

    type Blip = { angle: number; radius: number; lit: number; label: string };
    let blips: Blip[] = [];
    let sweep = 0;
    let rafId = 0;
    let running = true;

    const labels = [
      "HR-отдел",
      "карьерный сайт",
      "burst найма",
      "новый регион",
      "3 роли",
      "gate A",
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
      const cx = width / 2;
      const cy = height / 2;
      const maxR = Math.min(width, height) * 0.46;
      const count = Math.max(6, Math.round((width * height) / 26000));
      blips = Array.from({ length: count }, (_, i) => {
        const angle = Math.random() * Math.PI * 2;
        const radius = 30 + Math.random() * (maxR - 30);
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
      // base radial wash
      const g = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 1.4);
      g.addColorStop(0, "rgba(30, 64, 175, 0.10)");
      g.addColorStop(1, "rgba(15, 23, 42, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      drawRings(0.35);
      drawBlips(1);
    }

    function drawRings(alpha: number) {
      if (!ctx) return;
      const cx = cxRef.current;
      const cy = cyRef.current;
      const maxR = Math.min(width, height) * 0.46;
      ctx.strokeStyle = `rgba(59, 130, 246, ${alpha * 0.5})`;
      ctx.lineWidth = 1;
      for (let r = maxR * 0.3; r <= maxR; r += maxR * 0.23) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    function drawBlips(litFloor: number) {
      if (!ctx) return;
      const cx = cxRef.current;
      const cy = cyRef.current;
      for (const b of blips) {
        const x = cx + Math.cos(b.angle) * b.radius;
        const y = cy + Math.sin(b.angle) * b.radius;
        const intensity = Math.max(litFloor, b.lit);
        // halo
        if (intensity > 0.05) {
          const halo = ctx.createRadialGradient(x, y, 0, x, y, 14);
          halo.addColorStop(0, `rgba(96, 165, 250, ${intensity * 0.7})`);
          halo.addColorStop(1, "rgba(96, 165, 250, 0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(x, y, 14, 0, Math.PI * 2);
          ctx.fill();
        }
        // core dot
        ctx.fillStyle = `rgba(191, 219, 254, ${0.3 + intensity * 0.7})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        // label when freshly lit
        if (b.lit > 0.55) {
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
      const start = sweep - 0.5;
      const end = sweep;
      const grad = ctx.createLinearGradient(
        cx + Math.cos(start) * maxR,
        cy + Math.sin(start) * maxR,
        cx + Math.cos(end) * maxR,
        cy + Math.sin(end) * maxR,
      );
      grad.addColorStop(0, "rgba(59, 130, 246, 0)");
      grad.addColorStop(1, "rgba(59, 130, 246, 0.22)");
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
      // background wash
      const g = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 1.4);
      g.addColorStop(0, "rgba(30, 64, 175, 0.10)");
      g.addColorStop(1, "rgba(15, 23, 42, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      drawRings(0.35);
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
        }
        b.lit *= 0.985;
      }
      drawBlips(0);

      if (running) rafId = requestAnimationFrame(frame);
    }

    function onVisibility() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(rafId);
      } else if (!reduceMotion) {
        running = true;
        rafId = requestAnimationFrame(frame);
      }
    }

    resize();
    if (reduceMotion) {
      drawStatic();
    } else {
      rafId = requestAnimationFrame(frame);
    }
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
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
