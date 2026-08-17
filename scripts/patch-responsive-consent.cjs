const fs = require('node:fs');

const file = 'scripts/verify-responsive-surfaces.mjs';
const text = fs.readFileSync(file, 'utf8');
const needle = "      await page.waitForLoadState('networkidle', { timeout: 30_000 });\n\n      const status = response?.status() ?? 0;";
const replacement = [
  "      await page.waitForLoadState('networkidle', { timeout: 30_000 });",
  '',
  "      const analyticsConsent = page.locator('[data-analytics-consent=\"true\"]');",
  "      if (await analyticsConsent.isVisible().catch(() => false)) {",
  "        const allowAnalytics = analyticsConsent.getByRole('button', { name: 'Разрешить' });",
  "        if (await allowAnalytics.count() > 0) {",
  "          await allowAnalytics.click();",
  "          await analyticsConsent.waitFor({ state: 'hidden', timeout: 5_000 });",
  "        }",
  "      }",
  '',
  "      const status = response?.status() ?? 0;",
].join('\n');
const count = text.split(needle).length - 1;
if (count !== 1) throw new Error(`expected exactly one navigation marker, found ${count}`);
fs.writeFileSync(file, text.replace(needle, replacement));
