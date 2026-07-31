"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

const SCENES = [
  { id: "main-content", label: "Вход", code: "00" },
  { id: "preview", label: "Сигнал", code: "01" },
  { id: "how-it-works", label: "Проверка", code: "02" },
  { id: "quality", label: "Доказательства", code: "03" },
  { id: "pricing", label: "Запуск", code: "04" },
] as const;

export function CinematicLandingShell() {
  const pathname = usePathname();
  const [activeScene, setActiveScene] = useState(0);
  const [progress, setProgress] = useState(0);
  const [pointer, setPointer] = useState({ x: 50, y: 50 });
  const isLanding = pathname === "/";

  const sceneIds = useMemo(() => SCENES.map((scene) => scene.id), []);

  useEffect(() => {
    if (!isLanding) return;

    document.documentElement.dataset.cinematicLanding = "true";

    const updateProgress = () => {
      const max = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      setProgress(Math.min(1, Math.max(0, window.scrollY / max)));
    };

    const observers: IntersectionObserver[] = [];
    sceneIds.forEach((id, index) => {
      const element = document.getElementById(id);
      if (!element) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveScene(index);
        },
        { rootMargin: "-35% 0px -45% 0px", threshold: 0.01 },
      );
      observer.observe(element);
      observers.push(observer);
    });

    const updatePointer = (event: PointerEvent) => {
      setPointer({
        x: (event.clientX / window.innerWidth) * 100,
        y: (event.clientY / window.innerHeight) * 100,
      });
    };

    updateProgress();
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);
    window.addEventListener("pointermove", updatePointer, { passive: true });

    return () => {
      delete document.documentElement.dataset.cinematicLanding;
      observers.forEach((observer) => observer.disconnect());
      window.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
      window.removeEventListener("pointermove", updatePointer);
    };
  }, [isLanding, sceneIds]);

  if (!isLanding) return null;

  return (
    <div
      className="rr-cinematic-shell"
      style={{
        "--rr-scroll-progress": progress,
        "--rr-pointer-x": `${pointer.x}%`,
        "--rr-pointer-y": `${pointer.y}%`,
      } as React.CSSProperties}
      aria-hidden="true"
    >
      <div className="rr-cinematic-noise" />
      <div className="rr-cinematic-beam" />
      <div className="rr-cinematic-orbit rr-cinematic-orbit-a" />
      <div className="rr-cinematic-orbit rr-cinematic-orbit-b" />
      <div className="rr-cinematic-progress"><span /></div>

      <div className="rr-cinematic-wordmark">
        <span>RECRUITER</span>
        <strong>RADAR</strong>
      </div>

      <nav className="rr-cinematic-scenes" aria-label="Сцены лендинга">
        {SCENES.map((scene, index) => (
          <a
            key={scene.id}
            href={`#${scene.id}`}
            data-active={activeScene === index ? "true" : "false"}
            tabIndex={-1}
          >
            <span>{scene.code}</span>
            <strong>{scene.label}</strong>
          </a>
        ))}
      </nav>

      <div className="rr-cinematic-caption">
        <span>MARKET SIGNAL SYSTEM</span>
        <strong>{SCENES[activeScene]?.label}</strong>
      </div>
    </div>
  );
}
