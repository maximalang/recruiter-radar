import process from "node:process";

/**
 * D-8 (v3): deterministic motion/settle contract for the landing verification
 * scripts.
 *
 * The landing hero plays entrance animations (opacity + translateY) and stage
 * transitions, so `networkidle` plus fixed sleeps race the compositor on slow
 * runners: contrast/geometry asserts and full-page captures observe
 * mid-animation states, and a wedged browser leaves unbounded awaits pending
 * until the CI job timeout cancels the whole step (landing-playwright run
 * 36965532936 hung for 19 minutes inside the review-capture step with a live
 * chrome process and no exception).
 *
 * Every helper here is bounded; a settle timeout is a FAILURE, never a skip,
 * so the checks stay strict and CI stays deterministic.
 */

export const MOTION_SETTLE_TIMEOUT_MS = 5_000;

/** Turns a hung step into a deterministic failure with a clear reason. */
export function installScriptWatchdog(label, budgetMs) {
  const timer = setTimeout(() => {
    process.stderr.write(
      `\n${label}: watchdog budget ${budgetMs}ms exceeded — failing deterministically instead of hanging until the CI job timeout (D-8).\n`,
    );
    process.exit(1);
  }, budgetMs);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearTimeout(timer);
}

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Bounded pre-assert / pre-capture settle:
 *  1) webfonts loaded (document.fonts.ready);
 *  2) hydration complete and running CSS animations/transitions resolved
 *     (document.getAnimations() -> finished);
 *  3) hero geometry stable for two consecutive animation frames.
 * Exceeding the budget throws — the caller must fail, never continue.
 */
export async function settleLandingPage(page, { timeout = MOTION_SETTLE_TIMEOUT_MS, label = "landing" } = {}) {
  await withTimeout(
    page.evaluate(() => document.fonts.ready.then(() => true)),
    timeout,
    `${label}: document.fonts.ready`,
  );
  await withTimeout(
    page.evaluate(async () => {
      if (typeof document.getAnimations !== "function") return true;
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      );
      return true;
    }),
    timeout,
    `${label}: css animations finished`,
  );
  await withTimeout(
    page.evaluate(async (budgetMs) => {
      const target = document.querySelector("[data-hero-product-preview]") ?? document.body;
      const startedAt = Date.now();
      const snapshot = () => {
        const rect = target.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height, window.scrollX, window.scrollY].join("|");
      };
      let previous = snapshot();
      let stableFrames = 0;
      while (stableFrames < 2) {
        if (Date.now() - startedAt > budgetMs) {
          throw new Error("hero geometry did not stabilize within the settle budget");
        }
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
        const current = snapshot();
        stableFrames = current === previous ? stableFrames + 1 : 0;
        previous = current;
      }
      return true;
    }, timeout),
    timeout + 1_000,
    `${label}: stable animation frames`,
  );
}

/** Bounded teardown: a wedged browser must not hang the step forever. */
export async function closeQuietly(closable, label, ms = 10_000) {
  if (!closable) return;
  await withTimeout(
    (async () => {
      try {
        await closable.close();
      } catch (error) {
        process.stderr.write(`${label}: teardown failed (ignored): ${error?.message ?? error}\n`);
      }
    })(),
    ms,
    `${label}: close`,
  ).catch((error) => {
    process.stderr.write(`${label}: teardown timed out (ignored): ${error?.message ?? error}\n`);
  });
}
