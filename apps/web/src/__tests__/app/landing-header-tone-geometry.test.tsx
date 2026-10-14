/** @jest-environment jsdom */

/**
 * Deterministic regressions for the header-tone defect (night audit 2026-10-02;
 * causal report t_8c3282f8; QA signature t_5907d2f4).
 *
 * The tone IntersectionObserver in landing-header.tsx is batch-order dependent:
 * a partial delivery that contains a single threshold crossing (for example
 * only the light section re-entering the decision band after the harness'
 * final anchor-jump scroll, or a stale crossing of the dark section during a
 * slow upward scroll / resize recalculation) must NOT override the
 * geometry-authoritative tone (resolveToneByGeometry, the same decision marker
 * formula the active nav uses). Otherwise the resting data-tone depends on
 * scroll history and frame batching instead of layout — the exact production
 * audit failure signature: waitForFunction observes "dark", the next
 * data-tone read returns "light", while the active link stays «Разбор».
 *
 * These tests reproduce the failure deterministically against the real
 * component with a controlled IntersectionObserver and controlled geometry:
 * every assertion compares data-tone with the tone implied by the current
 * geometry (nearest marker above the decision line), never with IO history.
 */

import { act, render } from "@testing-library/react";

import LandingHeader from "@/app/landing/landing-header";

const HEADER_SELECTOR = '[data-brand-header="recruiter-radar"]';

/** Current layout: section id -> getBoundingClientRect().top in px. */
let geometry: Record<string, number> = {};

type DeliveredEntry = {
  target: HTMLElement;
  isIntersecting: boolean;
  ratio: number;
  /** Rect snapshot at threshold-crossing time; defaults to current geometry. */
  rectTop?: number;
};

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  private readonly callback: IntersectionObserverCallback;
  readonly observed: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  unobserve(): void {}

  disconnect(): void {}

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Deliver one IO batch, exactly like a browser frame would. */
  deliver(entries: DeliveredEntry[]): void {
    const batch = entries.map((entry) => ({
      isIntersecting: entry.isIntersecting,
      intersectionRatio: entry.ratio,
      boundingClientRect: { top: entry.rectTop ?? geometry[entry.target.id] ?? 0 },
      target: entry.target,
    })) as unknown as IntersectionObserverEntry[];
    act(() => {
      this.callback(batch, this as unknown as IntersectionObserver);
    });
  }
}

/**
 * The header's tone observer — not the next/link prefetch observer, which
 * also constructs IntersectionObservers for the rendered anchors.
 */
function toneObserver(): MockIntersectionObserver {
  const observer = MockIntersectionObserver.instances.find(
    (instance) => instance.observed.some((element) => element.hasAttribute("data-header-tone")),
  );
  if (!observer) throw new Error("tone IntersectionObserver was not constructed");
  return observer;
}

function makeSection(id: string, tone: "dark" | "light"): HTMLElement {
  const element = document.createElement("section");
  element.id = id;
  element.dataset.headerTone = tone;
  element.getBoundingClientRect = () => ({
    top: geometry[id] ?? 0,
    bottom: (geometry[id] ?? 0) + 760,
    height: 760,
    left: 0,
    right: 1440,
    width: 1440,
    x: 0,
    y: geometry[id] ?? 0,
    toJSON: () => ({}),
  } as DOMRect);
  document.body.appendChild(element);
  return element;
}

/** The product's existing decision marker (landing-header.tsx). */
function marker(): number {
  return Math.max(72, Math.min(window.innerHeight * 0.2, 160));
}

function setViewportHeight(height: number): void {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
}

let sections: { detection: HTMLElement; evidence: HTMLElement; delivery: HTMLElement };

beforeEach(() => {
  document.body.innerHTML = "";
  geometry = {};
  MockIntersectionObserver.instances = [];
  global.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  setViewportHeight(900);
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0)) as typeof requestAnimationFrame;
  window.cancelAnimationFrame = ((handle: number) => window.clearTimeout(handle)) as typeof cancelAnimationFrame;
  // Real page order: hero #scene-detection (light) -> #scene-evidence (dark)
  // -> #scene-delivery (light).
  sections = {
    detection: makeSection("scene-detection", "light"),
    evidence: makeSection("scene-evidence", "dark"),
    delivery: makeSection("scene-delivery", "light"),
  };
});

afterEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
});

function renderHeader(): HTMLElement {
  const { container } = render(<LandingHeader />);
  const header = container.querySelector<HTMLElement>(HEADER_SELECTOR);
  if (!header) throw new Error("landing header not rendered");
  return header;
}

function toneOf(header: HTMLElement): string | null {
  return header.getAttribute("data-tone");
}

describe("landing header tone geometry authority (t_8c3282f8 regression)", () => {
  it("keeps the geometry tone when the anchor-jump rest delivers a detection-only partial batch (QA L596 signature)", () => {
    // Anchor jump to #scene-evidence: harness settled at evTop=48 (audit
    // probe run1). Decision band at 1440x900 is 36..108px; marker is 160px.
    // Geometry: #scene-evidence (dark) is the nearest section at/below the
    // marker -> authoritative resting tone is dark.
    geometry = { "scene-detection": -560, "scene-evidence": 48, "scene-delivery": 808 };
    const header = renderHeader();

    // Initial full delivery right after the jump: both sections touch the
    // band, pre/post-patch behaviour agrees (nearest |top| = evidence).
    toneObserver().deliver([
      { target: sections.detection, isIntersecting: true, ratio: 0.02 },
      { target: sections.evidence, isIntersecting: true, ratio: 0.025 },
    ]);
    expect(toneOf(header)).toBe("dark");

    // Reproduction: the final small scroll only crosses detection's 0.01
    // threshold (ratio 0.00901); evidence stays between thresholds and is
    // absent from the batch. A history-dependent header flips to light here;
    // a geometry-authoritative header must stay dark (evTop 48 <= marker 160).
    toneObserver().deliver([
      { target: sections.detection, isIntersecting: true, ratio: 0.00901 },
    ]);
    expect(sections.evidence.getBoundingClientRect().top).toBeLessThanOrEqual(marker());
    expect(toneOf(header)).toBe("dark");
  });

  it("does not invert the tone from a stale evidence-only batch during a slow upward scroll", () => {
    // Resting on #scene-evidence: geometry dark (agreed by any strategy).
    geometry = { "scene-detection": -620, "scene-evidence": 100, "scene-delivery": 860 };
    const header = renderHeader();
    toneObserver().deliver([
      { target: sections.detection, isIntersecting: true, ratio: 0.02 },
      { target: sections.evidence, isIntersecting: true, ratio: 0.03 },
    ]);
    expect(toneOf(header)).toBe("dark");

    // Slow scroll up: evidence moved to top=170 (below the 160px marker), so
    // geometry now resolves to the light hero. The in-flight batch still
    // carries the single stale evidence crossing captured at top=100 during
    // the upward scroll (slowTrace inversion: tone followed the entry instead
    // of the layout and locked dark over the light section).
    geometry = { "scene-detection": -550, "scene-evidence": 170, "scene-delivery": 930 };
    toneObserver().deliver([
      { target: sections.evidence, isIntersecting: true, ratio: 0.01, rectTop: 100 },
    ]);
    expect(toneOf(header)).toBe("light");
  });

  it("follows geometry from dark to light across a small downward scroll past the dark section", () => {
    geometry = { "scene-detection": -100, "scene-evidence": 48, "scene-delivery": 808 };
    const header = renderHeader();
    toneObserver().deliver([
      { target: sections.detection, isIntersecting: true, ratio: 0.02 },
      { target: sections.evidence, isIntersecting: true, ratio: 0.025 },
    ]);
    expect(toneOf(header)).toBe("dark");

    // Small downward scroll lands on #scene-delivery (light): evidence exits
    // the band, delivery enters it. Both strategies must agree on light.
    geometry = { "scene-detection": -1400, "scene-evidence": -700, "scene-delivery": 90 };
    toneObserver().deliver([
      { target: sections.evidence, isIntersecting: false, ratio: 0 },
      { target: sections.delivery, isIntersecting: true, ratio: 0.02 },
    ]);
    expect(toneOf(header)).toBe("light");
  });

  it("re-resolves the tone from post-resize geometry instead of the resize crossing batch", () => {
    // Resting dark on #scene-evidence at 1440x900 (marker 160).
    geometry = { "scene-detection": -620, "scene-evidence": 100, "scene-delivery": 860 };
    const header = renderHeader();
    toneObserver().deliver([
      { target: sections.detection, isIntersecting: true, ratio: 0.02 },
      { target: sections.evidence, isIntersecting: true, ratio: 0.03 },
    ]);
    expect(toneOf(header)).toBe("dark");

    // Resize to 1440x700: marker becomes 140 and the band becomes 28..84.
    // Evidence now rests at top=150 (> 140) -> geometry resolves to the light
    // hero. The resize recalculation delivers a single evidence crossing
    // captured inside the new band (top=80); a history-dependent header would
    // keep/lock dark against its own geometry.
    setViewportHeight(700);
    geometry = { "scene-detection": -550, "scene-evidence": 150, "scene-delivery": 910 };
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    toneObserver().deliver([
      { target: sections.evidence, isIntersecting: true, ratio: 0.01, rectTop: 80 },
    ]);
    expect(marker()).toBe(140);
    expect(toneOf(header)).toBe("light");
  });
});
