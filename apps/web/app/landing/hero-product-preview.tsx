"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import sceneStyles from "./detection-scene.module.css";

type PageKey = "today" | "companies" | "radar" | "engineering" | "finance";
type Stage = 1 | 2 | 3 | 4;
type PeekState = "peek" | "opening" | "full" | "closing";

const AUTO_ADVANCE_MS = 8_000;
/* v3.1 §5.3: outgoing main exits in 180ms, then the scene swaps atomically. */
const SCENE_EXIT_MS = 180;
/* v3.1 R11: opening slide 760ms; the first scene starts when it completes. */
const SCENE_OPEN_MS = 760;
const SCENE_CLOSE_MS = 520;
const CLOSE_DELAY_MS = 120;
/* v3.1 §5.3 / R3: first-entry stage-1 typing — start 700ms from scene start,
 * ≤38ms per grapheme, cap 2500ms, complete no later than t=3200. No caret
 * ever exists; the full text stays accessible from the first frame. */
const TYPING_START_MS = 700;
const TYPING_MS_PER_GRAPHEME = 38;
const TYPING_MAX_MS = 2_500;

const PAGES: ReadonlyArray<{ key: PageKey; label: string; group: "cabinet" | "watch" }> = [
  { key: "today", label: "Сегодня", group: "cabinet" },
  { key: "companies", label: "Компании", group: "cabinet" },
  { key: "radar", label: "Результат", group: "cabinet" },
  { key: "engineering", label: "Инженерный подбор", group: "watch" },
  { key: "finance", label: "Финансовый софт", group: "watch" },
];

/* Owner verdict 24.09 (pass 2): the demo reads as one logical product story —
 * настройка → проверка → результат → действие. Each stage keeps one title,
 * one intro line and three compact product facts; marketing asides, cadence
 * sublabels, the price promise and the timer hint are removed as noise.
 * Owner verdict 26.09 (pass 9): the demo window reproduces the linear.app
 * hero demo layout — sidebar nav with icons and groups, issue topbar
 * (status dot + id + title + counter), tool row, activity-style content,
 * right summary column and a floating assistant panel — with Recruiter
 * Radar data inside.
 * v3.1 R10 (owner directive 04.10): stage/page titles only are reworded to
 * variant A; intros, rows, facts and the manual-send promise are untouched. */
const STAGES: ReadonlyArray<{
  id: Stage;
  label: string;
  eyebrow: string;
  title: string;
  intro: string;
  rows: ReadonlyArray<[string, string]>;
}> = [
  {
    id: 1,
    label: "Ваш рынок",
    eyebrow: "Шаг 1 · Настройка",
    title: "Инженерный подбор",
    intro: "Профиль заменяет десятки сохранённых поисков — радар следит за рынком сам.",
    rows: [
      ["Профиль", "Радар собрал профиль из вашей специализации: ниша, роли, география"],
      ["Критерии", "Вы добавили признаки спроса — профиль собирает компании"],
      ["Правки", "Радар: критерии можно изменить в любой момент"],
    ],
  },
  {
    id: 2,
    label: "27 источников",
    eyebrow: "Шаг 2 · Проверка",
    title: "Проверка по источникам",
    intro: "Радар отсеивает повторы и шум, оставляет только подтверждённые поводы.",
    rows: [
      ["Найм", "Радар нашёл новые роли — рост команд"],
      ["Реестры", "Радар подтвердил изменения реестрами и СМИ"],
      ["Фильтр", "Радар отклонил поводы без источника"],
    ],
  },
  {
    id: 3,
    label: "10 компаний",
    eyebrow: "Шаг 3 · Результат",
    title: "10 компаний за 7 дней",
    intro: "Повод, факты, источник и уверенность — в одной карточке.",
    rows: [
      ["Компании", "Радар отобрал приоритеты строго под профиль"],
      ["Повод", "У каждой компании — изменение, создающее момент"],
      ["Факты", "Независимые источники подтверждают каждый факт"],
    ],
  },
  {
    id: 4,
    label: "Готовый черновик",
    eyebrow: "Шаг 4 · Действие",
    title: "Черновик готов. Отправляете вы.",
    intro: "Сообщение опирается только на подтверждённые факты — без автоотправок.",
    rows: [
      ["Черновик", "Радар собрал первое сообщение по фактам компании"],
      ["Правки", "Вы редактируете черновик перед отправкой"],
      ["Отправка", "Вручную — с вашего аккаунта"],
    ],
  },
];

const PAGE_CONTENT: Record<Exclude<PageKey, "today">, {
  eyebrow: string;
  title: string;
  intro: string;
  rows: ReadonlyArray<[string, string]>;
}> = {
  companies: {
    eyebrow: "Компании",
    title: "История компании",
    intro: "Сигналы, проверки и ваши решения — в единой хронологии.",
    rows: [
      ["Хронология", "Все события и решения собраны рядом"],
      ["Связи", "Динамика компании, а не отдельные новости"],
      ["Шаг", "Понятно, что делать дальше"],
    ],
  },
  radar: {
    eyebrow: "Результат",
    title: "Результаты за 7 дней",
    intro: "Приоритетные компании вашего рынка — с поводом, фактами и черновиком.",
    rows: [
      ["Компании", "10 приоритетов строго под профиль"],
      ["Поводы", "Источник у каждого"],
      ["Черновики", "Готовое первое сообщение"],
    ],
  },
  engineering: {
    eyebrow: "Наблюдение",
    title: "Инженерный подбор",
    intro: "Рынки, где спрос видно раньше остальных.",
    rows: [
      ["Вакансии", "Рост команд и редкие роли в нише"],
      ["Публикации", "Компании объявляют расширение и новые площадки"],
      ["СМИ", "Поводы видны раньше общих новостей"],
    ],
  },
  finance: {
    eyebrow: "Наблюдение",
    title: "Финансовый софт",
    intro: "Компании, где момент создают запуски, сделки и рост найма.",
    rows: [
      ["Вакансии", "Растут продажи, внедрение, разработка и ИБ"],
      ["Продукт", "Новые решения и интеграции"],
      ["Сделки", "Финансирование и партнёрства"],
    ],
  },
};

/* Minimal 16px line-icon set mirroring the reference demo's sidebar/topbar
 * glyphs. Decorative only — every icon is aria-hidden. */
const ICON_PATHS: Record<string, string> = {
  back: "M9.8 3.6 5.4 8l4.4 4.4",
  bolt: "M8.8 1.8 4.2 8.6h3.3L7.2 14.2l4.6-6.8H8.5l.3-5.6Z",
  inbox: "M2 9.6 3.8 4h8.4l1.8 5.6V13H2V9.6Zm0 0h3.1l.9 1.6h4l.9-1.6h3.1",
  target: "M8 2.6a5.4 5.4 0 1 0 0 10.8A5.4 5.4 0 0 0 8 2.6Zm0 3.6a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z",
  branch: "M4.6 2.4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm0 7.6a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6ZM4.6 6v4m6.8-7.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Zm0 3.2v1.2a2 2 0 0 1-2 2H6.4",
  chart: "M3 13V8m5 5V3m5 10V6",
  search: "M7.2 2.8a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8Zm3.4 7.8 2.8 2.8",
  plus: "M8 3.4v9.2M3.4 8h9.2",
  caret: "m4.6 6.4 3.4 3.2 3.4-3.2",
  star: "m8 2.6 1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.3l-3.4 1.8.7-3.8L2.5 6.6l3.8-.5L8 2.6Z",
  link: "M6.8 9.2 9.2 6.8M5 7.4l-.8.8a2.4 2.4 0 0 0 3.4 3.4l.8-.8m2.6-4.2.8-.8a2.4 2.4 0 0 0-3.4-3.4l-.8.8",
  doc: "M3.6 2.4h8.8v11.2H3.6V2.4ZM6 6h4M6 8.6h4",
  panelIco: "M2.2 3.4h11.6v9.2H2.2V3.4Zm7.2 0v9.2",
  expand: "M9.6 3.6h2.8v2.8m0-2.8-4 4M6.4 12.4H3.6V9.6m0 2.8 4-4",
  up: "M8 11.4V4.6M5.2 7.4 8 4.6l2.8 2.8",
  down: "M8 4.6v6.8M5.2 8.6 8 11.4l2.8-2.8",
  more: "M3.6 8a1.1 1.1 0 1 0 0-.01Zm4.4 0a1.1 1.1 0 1 0 0-.01Zm4.4 0a1.1 1.1 0 1 0 0-.01Z",
  chevronHandle: "M10 3 5.5 8 10 13",
};

const NAV_ICONS: Record<PageKey, string> = {
  today: "bolt",
  companies: "inbox",
  radar: "target",
  engineering: "branch",
  finance: "chart",
};

function Ico({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/* R3: the typed line is the existing final text paragraph of the comment
 * card. Its full text is exposed to assistive technology from the first
 * frame; only the aria-hidden visual twin reveals grapheme by grapheme. */
const TYPE_LINE = "Этап 2 начнётся автоматически: проверю найденные поводы по источникам.";

type GraphemeSegmenterCtor = new (
  locale?: string,
  options?: { granularity: "grapheme" },
) => { segment(input: string): Iterable<{ segment: string }> };

function splitGraphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenterCtor }).Segmenter;
  if (Segmenter) {
    try {
      return Array.from(new Segmenter("ru", { granularity: "grapheme" }).segment(text), (entry) => entry.segment);
    } catch {
      // fall through to the codepoint-safe split below
    }
  }
  // Safe Unicode fallback: code points, never a UTF-16 slice.
  return Array.from(text);
}

const TYPE_GRAPHEMES = splitGraphemes(TYPE_LINE);
const TYPE_DURATION_MS = Math.min(TYPING_MS_PER_GRAPHEME * TYPE_GRAPHEMES.length, TYPING_MAX_MS);

function supportsPeekGeometry(): boolean {
  try {
    const css = (window as unknown as { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS;
    if (!css?.supports) return false;
    return css.supports("width", "1cqw") && css.supports("container-type", "inline-size");
  } catch {
    return false;
  }
}

export default function HeroProductPreview() {
  const [page, setPage] = useState<PageKey>("today");
  const [stage, setStage] = useState<Stage>(1);
  /* v3.1 §5.3: `stage` is the logical scene (tabs/aria-selected update
   * immediately); `shownStage` is what the panel renders — the swap is
   * atomic after the 180ms exit. `sceneEpoch` replays the entrance. */
  const [shownStage, setShownStage] = useState<Stage>(1);
  const [exiting, setExiting] = useState(false);
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [typedCount, setTypedCount] = useState<number | null>(null);

  /* v3.1 R11 peek-panel machine. SSR/no-JS renders the full static window;
   * enhancement commits the settled peek right after hydration. */
  const [jsReady, setJsReady] = useState(false);
  const [peekSupported, setPeekSupported] = useState(false);
  const [peekState, setPeekState] = useState<PeekState>("full");
  const [peekInstant, setPeekInstant] = useState(false);
  const [revealDone, setRevealDone] = useState(false);
  const [sceneStarted, setSceneStarted] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [heroIntersecting, setHeroIntersecting] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [manualMode, setManualMode] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const dockRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<Stage>(1);
  const shownRef = useRef<Stage>(1);
  const pageRef = useRef<PageKey>("today");
  const peekRef = useRef<PeekState>("full");
  const hoverRef = useRef(false);
  const keyboardRef = useRef(false);
  const pinRef = useRef(false);
  const suppressedRef = useRef(false);
  const escapeFocusRef = useRef(false);
  const leaveSeenRef = useRef(false);
  const sceneStartedRef = useRef(false);
  const typedOnceRef = useRef(false);
  const manualRef = useRef(false);
  const reducedRef = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const openTimer = useRef<number | null>(null);
  const exitTimer = useRef<number | null>(null);
  const typingStartTimer = useRef<number | null>(null);
  const typingDoneTimer = useRef<number | null>(null);
  const typingRaf = useRef<number | null>(null);

  pageRef.current = page;
  reducedRef.current = reducedMotion;

  const cancelPeekTimers = useCallback(() => {
    for (const timer of [closeTimer, settleTimer, openTimer]) {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    }
  }, []);

  const applyPeekState = useCallback((next: PeekState) => {
    peekRef.current = next;
    setPeekState(next);
  }, []);

  const cancelTyping = useCallback(() => {
    if (typingStartTimer.current !== null) {
      window.clearTimeout(typingStartTimer.current);
      typingStartTimer.current = null;
    }
    if (typingDoneTimer.current !== null) {
      window.clearTimeout(typingDoneTimer.current);
      typingDoneTimer.current = null;
    }
    if (typingRaf.current !== null) {
      window.cancelAnimationFrame(typingRaf.current);
      typingRaf.current = null;
    }
  }, []);

  const completeTyping = useCallback(() => {
    cancelTyping();
    setTypedCount(null);
  }, [cancelTyping]);

  const runTyping = useCallback(() => {
    if (typedOnceRef.current) return;
    typedOnceRef.current = true;
    if (reducedRef.current || typeof window.requestAnimationFrame !== "function") {
      setTypedCount(null);
      return;
    }
    setTypedCount(0);
    const startedAt = performance.now();
    const step = (now: number) => {
      const elapsed = now - startedAt;
      if (elapsed >= TYPE_DURATION_MS) {
        typingRaf.current = null;
        setTypedCount(null);
        return;
      }
      const next = Math.floor((elapsed / TYPE_DURATION_MS) * TYPE_GRAPHEMES.length);
      // One rAF per active reveal; repaint only when the visible grapheme
      // count actually changes.
      setTypedCount((current) => (current !== null && next !== current ? next : current));
      typingRaf.current = window.requestAnimationFrame(step);
    };
    typingRaf.current = window.requestAnimationFrame(step);
    // Deterministic completion backstop (also drives fake-timer tests).
    typingDoneTimer.current = window.setTimeout(() => {
      typingDoneTimer.current = null;
      if (typingRaf.current !== null) {
        window.cancelAnimationFrame(typingRaf.current);
        typingRaf.current = null;
      }
      setTypedCount(null);
    }, TYPE_DURATION_MS + 120);
  }, []);

  const startScene = useCallback(() => {
    setSceneEpoch((epoch) => epoch + 1);
    if (
      stageRef.current === 1
      && pageRef.current === "today"
      && !typedOnceRef.current
      && !reducedRef.current
    ) {
      typingStartTimer.current = window.setTimeout(() => {
        typingStartTimer.current = null;
        runTyping();
      }, TYPING_START_MS);
    }
  }, [runTyping]);

  const goFull = useCallback(() => {
    if (peekRef.current === "full" || peekRef.current === "opening") return;
    cancelPeekTimers();
    applyPeekState("opening");
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      applyPeekState("full");
      if (!sceneStartedRef.current) {
        sceneStartedRef.current = true;
        setSceneStarted(true);
        startScene();
      }
    }, SCENE_OPEN_MS);
  }, [applyPeekState, cancelPeekTimers, startScene]);

  const scheduleClose = useCallback(() => {
    if (peekRef.current === "peek") return;
    cancelPeekTimers();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      applyPeekState("closing");
      settleTimer.current = window.setTimeout(() => {
        settleTimer.current = null;
        applyPeekState("peek");
      }, SCENE_CLOSE_MS);
    }, CLOSE_DELAY_MS);
  }, [applyPeekState, cancelPeekTimers]);

  const updateIntent = useCallback(() => {
    const wantOpen = pinRef.current
      || (!suppressedRef.current && (hoverRef.current || keyboardRef.current));
    if (wantOpen) goFull();
    else scheduleClose();
  }, [goFull, scheduleClose]);

  const commitStage = useCallback((next: Stage, options: { manual?: boolean } = {}) => {
    if (options.manual && !manualRef.current) {
      manualRef.current = true;
      setManualMode(true);
    }
    stageRef.current = next;
    setStage(next);
    if (next === shownRef.current) return;
    cancelTyping();
    if (reducedRef.current || typeof window.requestAnimationFrame !== "function") {
      shownRef.current = next;
      setShownStage(next);
      return;
    }
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
    setExiting(true);
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      shownRef.current = stageRef.current;
      setShownStage(stageRef.current);
      setExiting(false);
    }, SCENE_EXIT_MS);
  }, [cancelTyping]);

  const selectStage = useCallback((next: Stage) => {
    setPage("today");
    commitStage(next, { manual: true });
  }, [commitStage]);

  /* v3.1 §5.3: a manual click on a tab/counter/sidebar stops the cadence
   * until reload; it never resumes spontaneously after the first blur. */
  const selectPage = useCallback((key: PageKey) => {
    setPage(key);
    if (!manualRef.current) {
      manualRef.current = true;
      setManualMode(true);
    }
  }, []);

  const prevStage = useCallback(() => {
    commitStage(stageRef.current === 1 ? 4 : ((stageRef.current - 1) as Stage), { manual: true });
  }, [commitStage]);

  const nextStage = useCallback(() => {
    commitStage(stageRef.current === 4 ? 1 : ((stageRef.current + 1) as Stage), { manual: true });
  }, [commitStage]);

  /* Enhancement commit (useEffect, not useLayoutEffect: SSR must stay
   * warning-free). The hero-demo reveal wrapper is still near-zero opacity
   * when this lands (its animation has a 140ms delay), so the initial
   * full→peek commit is invisible; data-peek-instant suppresses the slide
   * transition for that first state. */
  useEffect(() => {
    setJsReady(true);
    const supported = supportsPeekGeometry();
    setPeekSupported(supported);
    if (!supported) {
      // Fallback without container units: full static window, scene runs.
      sceneStartedRef.current = true;
      setSceneStarted(true);
      startScene();
      return undefined;
    }
    setPeekInstant(true);
    applyPeekState("peek");
    let outer = 0;
    let inner = 0;
    outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => setPeekInstant(false));
    });
    return () => {
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, [applyPeekState, startScene]);

  /* Reduced motion preference (live). */
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return undefined;
    setReducedMotion(query.matches);
    const listener = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener?.("change", listener);
    return () => query.removeEventListener?.("change", listener);
  }, []);

  /* §5.3 cadence gates: hero intersecting + tab visible + demo not focused
   * + not manual + dock full. Without IO support stay optimistically true. */
  useEffect(() => {
    if (!jsReady || typeof IntersectionObserver === "undefined") return undefined;
    const target = dockRef.current;
    if (!target) return undefined;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setHeroIntersecting(entry.isIntersecting);
    }, { threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [jsReady]);

  useEffect(() => {
    const update = () => setDocumentVisible(typeof document === "undefined" || document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  /* Outside tap releases a touch pin when no keyboard focus remains inside. */
  useEffect(() => {
    if (!jsReady || !peekSupported) return undefined;
    const onDocumentPointerDown = (event: PointerEvent) => {
      if (!pinRef.current) return;
      if (dockRef.current?.contains(event.target as Node)) return;
      if (keyboardRef.current) return;
      pinRef.current = false;
      updateIntent();
    };
    document.addEventListener("pointerdown", onDocumentPointerDown);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown);
  }, [jsReady, peekSupported, updateIntent]);

  /* Auto-advance: the existing 8000ms cadence under the v3.1 gates. */
  useEffect(() => {
    if (page !== "today" || reducedMotion || !sceneStarted) return undefined;
    if (peekState !== "full") return undefined;
    if (focusInside || manualMode) return undefined;
    if (!heroIntersecting || !documentVisible) return undefined;
    const timer = window.setTimeout(() => {
      commitStage(stageRef.current === 4 ? 1 : ((stageRef.current + 1) as Stage));
    }, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [page, stage, reducedMotion, sceneStarted, peekState, focusInside, manualMode, heroIntersecting, documentVisible, commitStage]);

  /* Full cleanup on unmount. */
  useEffect(() => () => {
    cancelPeekTimers();
    cancelTyping();
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
  }, [cancelPeekTimers, cancelTyping]);

  const peekActive = jsReady && peekSupported;
  const openish = peekState === "full" || peekState === "opening";

  const finishRevealEarly = useCallback(() => setRevealDone(true), []);

  const onDockPointerEnter = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!peekActive || event.pointerType === "touch") return;
    finishRevealEarly();
    if (leaveSeenRef.current) {
      leaveSeenRef.current = false;
      suppressedRef.current = false;
    }
    hoverRef.current = true;
    updateIntent();
  }, [finishRevealEarly, peekActive, updateIntent]);

  const onDockPointerLeave = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!peekActive || event.pointerType === "touch") return;
    hoverRef.current = false;
    leaveSeenRef.current = true;
    updateIntent();
  }, [peekActive, updateIntent]);

  const onDockFocus = useCallback(() => {
    if (!peekActive) return;
    finishRevealEarly();
    if (escapeFocusRef.current) {
      // Focus returned by the Escape close must not re-open the dock.
      escapeFocusRef.current = false;
    } else {
      suppressedRef.current = false;
    }
    keyboardRef.current = true;
    setFocusInside(true);
    // A keyboard visitor never waits for typing: the line completes at once.
    completeTyping();
    updateIntent();
  }, [completeTyping, finishRevealEarly, peekActive, updateIntent]);

  const onDockBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    if (!peekActive) return;
    if (event.relatedTarget instanceof Node && dockRef.current?.contains(event.relatedTarget)) return;
    keyboardRef.current = false;
    setFocusInside(false);
    updateIntent();
  }, [peekActive, updateIntent]);

  const onDockKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !peekActive) return;
    if (peekRef.current === "peek" || peekRef.current === "closing") return;
    // Escape closes from full, parks focus on the never-inert handle and
    // suppresses auto-reopen until explicit input or a real leave+enter.
    suppressedRef.current = true;
    pinRef.current = false;
    hoverRef.current = false;
    const handle = handleRef.current;
    if (handle && document.activeElement !== handle) {
      escapeFocusRef.current = true;
      handle.focus({ preventScroll: true });
    }
    updateIntent();
  }, [peekActive, updateIntent]);

  const onDockClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!peekActive) return;
    if (event.target instanceof Element && event.target.closest(`.${sceneStyles.peekHandle}`)) return;
    if (openish) return;
    // First tap on the visible part of the closed window only opens/pins;
    // the underlying demo click is not performed. The next tap is normal.
    event.preventDefault();
    event.stopPropagation();
    finishRevealEarly();
    suppressedRef.current = false;
    pinRef.current = true;
    updateIntent();
  }, [finishRevealEarly, openish, peekActive, updateIntent]);

  const onHandleClick = useCallback(() => {
    if (!peekActive) return;
    finishRevealEarly();
    suppressedRef.current = false;
    const nowOpen = peekRef.current === "full" || peekRef.current === "opening";
    pinRef.current = !nowOpen;
    updateIntent();
  }, [finishRevealEarly, peekActive, updateIntent]);

  const currentStage = STAGES[shownStage - 1];
  const typedText = typedCount === null ? TYPE_LINE : TYPE_GRAPHEMES.slice(0, typedCount).join("");

  return (
    <div
      className={sceneStyles.peekReveal}
      data-v31-reveal="hero-demo"
      data-reveal-done={revealDone || undefined}
    >
      <div
        ref={dockRef}
        className={sceneStyles.peekDock}
        data-demo-peek="workflow"
        data-peek-state={peekActive ? peekState : undefined}
        data-peek-js={peekActive ? "true" : undefined}
        data-peek-instant={peekInstant || undefined}
        onPointerEnter={peekActive ? onDockPointerEnter : undefined}
        onPointerLeave={peekActive ? onDockPointerLeave : undefined}
        onFocus={peekActive ? onDockFocus : undefined}
        onBlur={peekActive ? onDockBlur : undefined}
        onKeyDown={peekActive ? onDockKeyDown : undefined}
        onClickCapture={peekActive ? onDockClickCapture : undefined}
      >
        <div className={sceneStyles.peekSlide}>
          <button
            type="button"
            ref={handleRef}
            className={sceneStyles.peekHandle}
            data-peek-handle=""
            aria-controls="hero-workflow-panel"
            aria-expanded={openish}
            aria-label={openish ? "Свернуть демо" : "Развернуть демо"}
            onClick={onHandleClick}
          >
            <Ico name="chevronHandle" />
          </button>
          <figure
            id="hero-workflow"
            className={sceneStyles.productShot}
            style={{ scrollMarginTop: "calc(72px + 32px)" }}
            data-hero-product-preview="workflow"
            data-hero-workflow
            data-active-page={page}
            data-active-stage={stage}
            tabIndex={-1}
            inert={peekActive && !openish ? true : undefined}
            aria-label="Интерактивный workflow Recruiter Radar: настройка рынка, проверка источников, подтверждённый повод и подготовка сообщения."
          >
            <div className={sceneStyles.shotBody}>
              <aside className={sceneStyles.shotSide} aria-label="Разделы workflow">
                <div className={sceneStyles.sideWorkspace}>
                  <img className={sceneStyles.shotMark} src="/brand/recruiter-radar-mark-brand15.svg" width={32} height={32} alt="" aria-hidden="true" draggable={false} />
                  <strong>Recruiter Radar</strong>
                  <span className={sceneStyles.sideWorkspaceTools} aria-hidden="true">
                    <Ico name="caret" />
                    <Ico name="search" />
                    <Ico name="plus" />
                  </span>
                </div>
                <div className={sceneStyles.shotNav}>
                  {PAGES.filter((item) => item.group === "cabinet").map((item) => (
                    <button key={item.key} type="button" className={page === item.key ? sceneStyles.shotNavActive : undefined} onClick={() => selectPage(item.key)}>
                      <Ico name={NAV_ICONS[item.key]} />
                      {item.label}
                    </button>
                  ))}
                </div>
                <p className={sceneStyles.sideGroup}>Наблюдения <Ico name="caret" /></p>
                <div className={sceneStyles.shotNav}>
                  {PAGES.filter((item) => item.group === "watch").map((item) => (
                    <button key={item.key} type="button" className={page === item.key ? sceneStyles.shotNavActive : undefined} onClick={() => selectPage(item.key)}>
                      <Ico name={NAV_ICONS[item.key]} />
                      {item.label}
                    </button>
                  ))}
                </div>
                <p className={sceneStyles.sideGroup}>Этапы пилота <Ico name="caret" /></p>
                <div className={sceneStyles.workflowTabs} role="tablist" aria-label="Этапы workflow">
                  {STAGES.map((item) => (
                    <button
                      key={item.id}
                      id={`hero-workflow-tab-${item.id}`}
                      type="button"
                      role="tab"
                      aria-selected={stage === item.id}
                      aria-controls="hero-workflow-panel"
                      className={stage === item.id ? sceneStyles.workflowTabActive : undefined}
                      onClick={() => selectStage(item.id)}
                    >
                      <span className={sceneStyles.stageState} data-state={item.id < stage ? "done" : item.id === stage ? "active" : "todo"} aria-hidden="true" /><span><b>{item.label}</b></span>
                    </button>
                  ))}
                </div>
                <div className={sceneStyles.sideUser}>
                  <span aria-hidden="true">7д</span>
                  <small>Недельный пилот</small>
                </div>
              </aside>

              <div className={sceneStyles.shotWorkspace}>
                <header className={sceneStyles.shotWorkspaceHeader}>
                  <span className={sceneStyles.shotBack} aria-hidden="true"><Ico name="back" /></span>
                  <span className={sceneStyles.shotCrumb} aria-hidden="true">Радар</span>
                  <span className={sceneStyles.shotCrumbSep} aria-hidden="true">/</span>
                  <span className={sceneStyles.shotCrumb} aria-hidden="true">Пилот</span>
                  <span className={sceneStyles.shotStatus} aria-hidden="true" />
                  <span className={sceneStyles.shotIssueId}>RR-1042</span>
                  <strong>{page === "today" ? currentStage.title : PAGE_CONTENT[page].title}</strong>
                  <span className={sceneStyles.shotHeaderTools} aria-hidden="true">
                    <Ico name="star" />
                    <Ico name="more" />
                  </span>
                  {page === "today" ? (
                    <span className={sceneStyles.shotCounter}>
                      <b>{stage} / 4</b>
                      <button type="button" aria-label="Предыдущий этап" onClick={prevStage}><Ico name="up" /></button>
                      <button type="button" aria-label="Следующий этап" onClick={nextStage}><Ico name="down" /></button>
                    </span>
                  ) : null}
                </header>

                <div className={sceneStyles.shotToolRow} aria-hidden="true">
                  <span className={sceneStyles.shotToolCaption}>Интерактивный workflow</span>
                  <span className={sceneStyles.shotToolIco}><Ico name="link" /></span>
                  <span className={sceneStyles.shotToolIco}><Ico name="doc" /></span>
                  <span className={sceneStyles.shotToolIco}><Ico name="panelIco" /></span>
                  <span className={sceneStyles.shotToolIco}><Ico name="expand" /></span>
                </div>

                {page === "today" ? (
                  <div className={sceneStyles.workflowArea}>
                    <article
                      id="hero-workflow-panel"
                      className={sceneStyles.workflowPanel}
                      role="tabpanel"
                      aria-live="polite"
                      aria-labelledby={`hero-workflow-tab-${stage}`}
                    >
                      <div
                        className={sceneStyles.workflowMain}
                        key={`stage-${shownStage}-${sceneEpoch}`}
                        data-scene-exit={exiting || undefined}
                      >
                        <span className={sceneStyles.workflowEyebrow}>{currentStage.eyebrow}</span>
                        <h2>{currentStage.title}</h2>
                        <p className={sceneStyles.workflowIntro}>{currentStage.intro}</p>
                        <p className={sceneStyles.activityHead}>Активность<span className={sceneStyles.activityCount} aria-hidden="true">{currentStage.rows.length + 1}</span></p>
                        <dl className={sceneStyles.workflowRows}>
                          {currentStage.rows.map(([label, copy]) => (
                            <div key={label}>
                              {copy.startsWith("Вы ") ? (
                                <span className={sceneStyles.rowAv} data-actor="you" aria-hidden="true">Вы</span>
                              ) : (
                                <span className={sceneStyles.rowAv} aria-hidden="true">RR</span>
                              )}
                              <dt>{label}</dt>
                              <dd>{copy}</dd>
                            </div>
                          ))}
                        </dl>
                        <div className={sceneStyles.cmtCard}>
                          <span className={sceneStyles.cmtAv} aria-hidden="true">RR</span>
                          <div className={sceneStyles.cmtBody}>
                            <p className={sceneStyles.cmtHead}><strong>Радар</strong><span>AI-агент</span></p>
                            <p className={sceneStyles.demoType} data-demo-type="">
                              <span className={sceneStyles.visuallyHidden}>{TYPE_LINE}</span>
                              <span className={sceneStyles.typeGhost} aria-hidden="true">{TYPE_LINE}</span>
                              <span className={sceneStyles.typeLive} aria-hidden="true">{typedText}</span>
                            </p>
                          </div>
                        </div>
                        <p className={sceneStyles.cmtGhost} aria-hidden="true">Оставьте комментарий…</p>
                      </div>
                      <aside className={sceneStyles.shotProps} aria-label="Сводка этапа">
                        <div className={sceneStyles.propsCard}>
                          <h3>Сводка</h3>
                          <p className={sceneStyles.propsStatus}><span className={sceneStyles.statusDot} aria-hidden="true" />Этап {stage} из 4</p>
                          <dl className={sceneStyles.propList}>
                            <div><dt>Профиль</dt><dd>Инженерный подбор</dd></div>
                            <div><dt>Приоритет</dt><dd>Высокий</dd></div>
                            <div><dt>Источники</dt><dd>подключены</dd></div>
                            <div><dt>Отправка</dt><dd>Только вручную</dd></div>
                          </dl>
                        </div>
                        <div className={sceneStyles.aiFloat} aria-hidden="true">
                          <div className={sceneStyles.aiFloatHead}>
                            <img className={sceneStyles.shotMark} src="/brand/recruiter-radar-mark-brand15.svg" width={32} height={32} alt="" aria-hidden="true" draggable={false} />
                            <strong>Радар</strong>
                            <em>AI</em>
                            <span className={sceneStyles.aiFloatCaret}><Ico name="caret" /></span>
                          </div>
                          <p className={sceneStyles.aiFloatCard}>Найти 10 компаний с поводом написать</p>
                          <p className={sceneStyles.aiFloatCtx}>RR-1042 · профиль рынка в контексте</p>
                          <p className={sceneStyles.aiFloatState}><span />Сканирует источники…</p>
                        </div>
                      </aside>
                    </article>
                  </div>
                ) : (
                  <article className={sceneStyles.infoPage} key={`page-${page}`} aria-live="polite">
                    <span>{PAGE_CONTENT[page].eyebrow}</span>
                    <h2>{PAGE_CONTENT[page].title}</h2>
                    <p>{PAGE_CONTENT[page].intro}</p>
                    <dl>
                      {PAGE_CONTENT[page].rows.map(([label, copy], index) => (
                        <div key={label}><i>{String(index + 1).padStart(2, "0")}</i><dt>{label}</dt><dd>{copy}</dd></div>
                      ))}
                    </dl>
                    <button type="button" onClick={() => selectPage("today")}>Вернуться к workflow</button>
                  </article>
                )}
              </div>
            </div>
          </figure>
          {/* R11 reserved caption slot: 88px + 12px gap, part of the exact
              dock height. The baseline has no visible caption copy, so the
              slot stays empty — no new marketing text is introduced. */}
          <div className={sceneStyles.shotCaption} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
