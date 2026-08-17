from pathlib import Path

path = Path('apps/web/scripts/verify-landing-production.mjs')
text = path.read_text()

replacements = [
    (
        '  "#scene-evidence",\n  "#scene-delivery",',
        '  "#scene-evidence",\n  "#scene-radar",\n  "#scene-delivery",',
    ),
    (
        '  { name: "hash-evidence-1440x900", hash: "scene-evidence", target: "#scene-evidence" },\n  { name: "hash-delivery-1440x900", hash: "scene-delivery", target: "#scene-delivery" },',
        '  { name: "hash-evidence-1440x900", hash: "scene-evidence", target: "#scene-evidence" },\n  { name: "hash-radar-1440x900", hash: "scene-radar", target: "#scene-radar" },\n  { name: "hash-delivery-1440x900", hash: "scene-delivery", target: "#scene-delivery" },',
    ),
    (
        '  assert.match(await page.locator("#scene-evidence").innerText(), /доказатель|факт/i);\n  assert.match(await page.locator("#scene-delivery").innerText(), /Сообщения компаниям не отправляются автоматически/i);\n  const pricingText = await page.locator("#pricing").innerText();',
        '  assert.match(await page.locator("#scene-evidence").innerText(), /доказатель|факт/i);\n  assert.match(await page.locator("#scene-radar").innerText(), /свежесть|подтвержден/i);\n  assert.equal(await page.locator("#scene-radar [data-radar-spatial-model]").getAttribute("data-radar-spatial-model"), "recency-confidence");\n  assert.equal(await page.locator("#scene-radar [data-radar-semantic-list]").count(), 1);\n  assert.match(await page.locator("#scene-delivery").innerText(), /Сообщения компаниям не отправляются автоматически/i);\n  const pricingText = await page.locator("#pricing").innerText();',
    ),
    (
        '      "#scene-evidence",\n      "#scene-delivery",',
        '      "#scene-evidence",\n      "#scene-radar",\n      "#scene-delivery",',
    ),
    (
        '      "#scene-evidence h2",\n      "#scene-delivery h2",',
        '      "#scene-evidence h2",\n      "#scene-radar h2",\n      "#scene-delivery h2",',
    ),
    (
        '''  const brandHeader = page.locator('header[data-brand-header="recruiter-radar"]');
  await page.locator("#scene-evidence").scrollIntoViewIfNeeded();
  await page.waitForTimeout(180);
  assert.match(await brandHeader.locator("a[aria-current='location']").first().innerText(), /Как работает/);
  assert.equal(await brandHeader.getAttribute("data-tone"), "dark");
  await page.locator("#scene-delivery").scrollIntoViewIfNeeded();
  await page.waitForTimeout(180);
  assert.equal(await brandHeader.getAttribute("data-tone"), "light");''',
        '''  const brandHeader = page.locator('header[data-brand-header="recruiter-radar"]');
  await page.locator("#scene-evidence").scrollIntoViewIfNeeded();
  await page.waitForTimeout(180);
  assert.match(await brandHeader.locator("a[aria-current='location']").first().innerText(), /Как работает/);
  assert.equal(await brandHeader.getAttribute("data-tone"), "light");
  await page.locator("#scene-radar").scrollIntoViewIfNeeded();
  await page.waitForTimeout(180);
  assert.equal(await brandHeader.getAttribute("data-tone"), "dark");
  assert.equal(await page.locator("#scene-radar [data-radar-spatial-model]").getAttribute("data-radar-spatial-model"), "recency-confidence");
  assert.equal(await page.locator("#scene-radar [data-radar-semantic-list]").count(), 1);
  await page.locator("#scene-delivery").scrollIntoViewIfNeeded();
  await page.waitForTimeout(180);
  assert.equal(await brandHeader.getAttribute("data-tone"), "light");''',
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'landing Radar QA replacement mismatch ({count}): {old[:100]!r}')
    text = text.replace(old, new)

path.write_text(text)
