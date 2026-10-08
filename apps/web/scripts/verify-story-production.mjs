import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const base = (process.env.LANDING_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const out = process.env.STORY_ARTIFACT_DIR ?? path.resolve(here, '../artifacts/story');
await fs.mkdir(out, { recursive: true });
const copySource = await fs.readFile(path.resolve(here, '../app/story/story-copy.ts'), 'utf8');
const source = ts.createSourceFile('copy.ts', copySource, ts.ScriptTarget.Latest, true);
const copy = {};
function visit(node) {
  if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)) copy[node.name.getText(source)] = node.initializer.text;
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(Object.keys(copy).length, 49);
const banned = /ежедневн|каждый день|дней назад|предсказыв|990|17×|пост основателя|соцсетях команды|раунде финансирования|горячий, тёплый|сигнал горячий|Они отвечают|Свежий сигнал — свежий ответ/iu;
const normalize = (value) => value.replace(/\s+/g, ' ').trim();
const sceneIds = ['hero', 'problem', 'signals', 'priority', 'contact', 'card', 'boundary', 'closing'];
const report = [];
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });

async function settle(page) { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(900); }

// Same overflow/clipping contract as the landing audit, expanded to every story
// scene and leaf. Only the pre-existing native miniature demo regime is excluded.
async function assertNoOverlapOrClipping(page, label) {
  const issues = await page.evaluate(() => {
    const root = document.querySelector('[data-story-experience]');
    const elements = [...root.querySelectorAll('header, footer, section, h1, h2, h3, p, blockquote, figcaption, article, a, summary, button, input')];
    const leaves = [];
    const issues = [];
    for (const e of elements) {
      if (e.closest('[data-hero-workflow], [data-demo-appearance]')) continue; // Existing teaser exception, not a new story exemption.
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      if (!r.width || !r.height || s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
      if (e.matches('a') && e.getAttribute('href') === '#story-main' && document.activeElement !== e) continue;
      if (e.matches('a,button,input,summary') && (r.width < 44 || r.height < 44)) issues.push({ type: 'small-control', text: e.textContent.slice(0,60), rect: r.toJSON() });
      if (r.left < -2 || r.right > document.documentElement.clientWidth + 2) issues.push({ type: 'outside', text: e.textContent.slice(0,60), rect: r.toJSON() });
      if (['hidden','clip'].includes(s.overflow) && (e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2)) issues.push({ type: 'clipped', text: e.textContent.slice(0,60) });
      if (e.matches('h1,h2,h3,p,blockquote,figcaption,a,summary') && !e.querySelector('h1,h2,h3,p,blockquote,figcaption,a,summary')) leaves.push({ e, r });
    }
    for (let i=0; i<leaves.length; i++) for (let j=i+1; j<leaves.length; j++) {
      const a=leaves[i], b=leaves[j];
      if (a.e.contains(b.e)||b.e.contains(a.e)) continue;
      if (Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left)>2 && Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top)>2) issues.push({ type:'overlap', a:a.e.textContent.slice(0,40), b:b.e.textContent.slice(0,40) });
    }
    return issues;
  });
  assert.deepEqual(issues, [], `${label}: ${JSON.stringify(issues)}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `${label}: horizontal overflow`);
}

async function assertTruth(page) {
  const text = normalize(await page.locator('[data-story-experience]').textContent());
  assert.equal(banned.test(text), false, 'truth gate: banned phrase');
  for (const [key, value] of Object.entries(copy)) {
    if (key.startsWith('meta_')) continue;
    assert.ok(text.includes(normalize(value)), `copy missing: ${key}`);
  }
  assert.equal(await page.locator('[data-story-cta]').count(), 3);
  for (const link of await page.locator('[data-story-cta]').all()) assert.equal(await link.getAttribute('href'), 'https://recruiter-radar.ru');
  assert.equal(await page.locator('h1').count(), 1);
  assert.deepEqual(await page.locator('[data-story-scene]').evaluateAll((els)=>els.map(e=>e.dataset.storyScene)), sceneIds);
}

async function contrast(page) {
  return page.locator('[data-story-cta=hero]').evaluate((e)=>{
    const rgb=(s)=>s.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    const l=(s)=>{const [r,g,b]=rgb(s);return .2126*r+.7152*g+.0722*b;};
    const s=getComputedStyle(e),a=l(s.color),b=l(s.backgroundColor); return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });
}

async function auditMode(name, viewport, options={}) {
  const context = await browser.newContext({viewport, locale:'ru-RU', reducedMotion:'reduce', ...options});
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  if (name==='no-observer') await page.addInitScript(()=>{delete window.IntersectionObserver;});
  const response=await page.goto(`${base}/story`,{waitUntil:'networkidle'});
  assert.equal(response.status(),200);
  await settle(page);
  await assertTruth(page);
  for (const id of sceneIds) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded(); await settle(page);
    await assertNoOverlapOrClipping(page, `${name}/${id}`);
  }
  assert.equal(await page.locator('[data-story-state=pending]').count(),0,`${name}: content hidden`);
  const ratio=await contrast(page); assert.ok(ratio>=4.5,`${name}: CTA contrast ${ratio}`);
  if (options.javaScriptEnabled !== false) {
    await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
    const axe=await page.evaluate(async()=>await window.axe.run('[data-story-experience]',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
    assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],`${name}: axe`);
  }
  assert.deepEqual(errors,[],`${name}: page errors`);
  if (['desktop','mobile-390','mobile-320'].includes(name)) {
    await page.evaluate(()=>scrollTo(0,0));await settle(page);
    await page.screenshot({path:path.join(out,`${name}-hero.png`)});
    for (const id of ['signals','card']) {await page.locator(`#${id}`).scrollIntoViewIfNeeded();await settle(page);await page.screenshot({path:path.join(out,`${name}-${id}.png`)});}
  }
  report.push({name,viewport,contrast:ratio,scenes:sceneIds.length,truth:'49 copy entries; banned=0',geometry:'pass',errors});
  await context.close();
}

try {
  for (const [name, viewport, options] of [
    ['desktop',{width:1440,height:900},{}], ['mobile-390',{width:390,height:844},{}], ['mobile-320',{width:320,height:568},{}],
    ['tablet',{width:768,height:1024},{}], ['zoom-200',{width:720,height:450},{}],
    ['no-js',{width:390,height:844},{javaScriptEnabled:false}], ['no-observer',{width:390,height:844},{reducedMotion:'no-preference'}],
  ]) await auditMode(name,viewport,options);

  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
  const page=await context.newPage();await page.goto(`${base}/story`,{waitUntil:'networkidle'});await settle(page);
  assert.equal(await page.locator('[data-demo-appearance]').getAttribute('data-demo-appearance'),'pending','demo starts offscreen/pending');
  assert.equal(await page.locator('[data-peek-js=true]').count(),0,'demo enhancement must not start on load');
  assert.equal(await page.locator('#hero [data-story-state=pending]').count(),0,'hero present on load');
  await page.locator('[data-demo-appearance]').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('[data-demo-appearance]')?.dataset.demoAppearance==='visible');await settle(page);
  const handle=page.locator('[data-peek-handle]');await handle.focus();
  await page.waitForFunction(()=>document.querySelector('[data-demo-peek]')?.dataset.peekState==='full');
  for(const id of [2,3,4,1]) {await page.locator(`#hero-workflow-tab-${id}`).click();await page.waitForFunction(id=>document.querySelector('[data-hero-workflow]')?.dataset.activeStage===String(id),id);await settle(page);}
  await page.screenshot({path:path.join(out,'desktop-demo-expanded.png')});
  await page.locator('[data-hero-workflow]').getByRole('button',{name:'Компании',exact:true}).click();
  assert.equal(await page.locator('[data-hero-workflow]').getAttribute('data-active-page'),'companies');
  await page.locator('[data-hero-workflow]').getByRole('button',{name:'Вернуться к workflow'}).click();
  // The returned-from-page button unmounts; Escape is a dock-scoped keyboard
  // command, so place focus on its live tab before exercising it.
  await page.locator('#hero-workflow-tab-1').focus();
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('[data-demo-peek]')?.dataset.peekState==='peek');
  assert.equal(await handle.evaluate(e=>e===document.activeElement),true,'Escape parks keyboard focus');
  await page.locator('#signals').scrollIntoViewIfNeeded();await settle(page);
  assert.equal(await page.locator('#signals [data-story-state=pending]').count(),0,'cards reveal on scroll');
  report.push({name:'normal-motion',demo:'scroll-gated',interaction:'4 tabs + sidebar + Escape/focus preserved',cards:'scroll reveal'});
  await context.close();
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:'pass',report,out},null,2));
} finally {await browser.close();}
