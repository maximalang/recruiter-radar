"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_DOM_EVENT,
  LANDING_ANALYTICS_EVENT,
} from "../../lib/landing-analytics-contract";

export const LANDING_MOTION_EVENT = "landing:motionchange";
export const LANDING_MOTION_STORAGE_KEY = "landing-motion-preference";

export type LandingMotionDetail = {
  paused: boolean;
  reduced: boolean;
};

type LandingMotionState = "running" | "paused" | "reduced";

type LandingMotionContextValue = LandingMotionDetail & {
  state: LandingMotionState;
  toggle: () => void;
};

const DEFAULT_MOTION: LandingMotionContextValue = {
  paused: false,
  reduced: false,
  state: "running",
  toggle: () => {},
};

const LandingMotionContext = createContext<LandingMotionContextValue | null>(null);

function readSystemPreference(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function readStoredPause(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(LANDING_MOTION_STORAGE_KEY) === "paused";
  } catch {
    return false;
  }
}

export function LandingMotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(readSystemPreference);
  const [userPaused, setUserPaused] = useState(readStoredPause);
  const paused = reduced || userPaused;
  const state: LandingMotionState = reduced ? "reduced" : userPaused ? "paused" : "running";

  useLayoutEffect(() => {
    document.documentElement.dataset.landingMotion = state;
    window.dispatchEvent(
      new CustomEvent<LandingMotionDetail>(LANDING_MOTION_EVENT, {
        detail: { paused, reduced },
      }),
    );
  }, [paused, reduced, state]);

  useLayoutEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const toggle = useCallback(() => {
    if (reduced) return;
    const next = !userPaused;
    try {
      window.sessionStorage.setItem(
        LANDING_MOTION_STORAGE_KEY,
        next ? "paused" : "running",
      );
    } catch {
      // The in-memory preference remains usable when storage is unavailable.
    }
    setUserPaused(next);
    window.dispatchEvent(
      new CustomEvent(LANDING_ANALYTICS_DOM_EVENT, {
        detail: {
          name: next
            ? LANDING_ANALYTICS_EVENT.motionPaused
            : LANDING_ANALYTICS_EVENT.motionResumed,
          context: LANDING_ANALYTICS_CONTEXT.motionControl,
        },
      }),
    );
  }, [reduced, userPaused]);

  const value = useMemo<LandingMotionContextValue>(
    () => ({ paused, reduced, state, toggle }),
    [paused, reduced, state, toggle],
  );

  return (
    <LandingMotionContext.Provider value={value}>
      <div
        data-landing-motion-root
        data-landing-motion={state}
        style={{ display: "contents" }}
        suppressHydrationWarning
      >
        {children}
      </div>
    </LandingMotionContext.Provider>
  );
}

export function useLandingMotion(): LandingMotionContextValue {
  return useContext(LandingMotionContext) ?? DEFAULT_MOTION;
}
