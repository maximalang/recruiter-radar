import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Real browser wheel input, not scrollIntoView, fabricated IO callbacks or timers.
export async function verifyStoryScroll(browser, base, out) {
  const results = [];
  for (const [name, viewport] of [['desktop',{width:1440,height:900}], ['mobile-390',{width:390,height:844}], ['mobile-320',{width:320,height:568}]]) {
    const context = await browser.newContext({viewport,reducedMotion:'no-preference',hasTouch:name !== 'desktop',recordVideo:{dir:out,size:viewport}});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${base}/story`,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>document.querySelector('[data-test=header]')?.dataset.headerEnhanced==='true');
    await page.waitForTimeout(600);
    const header = page.locator('[data-test=header]');
    const panel = page.locator('[data-header-panel]');
    const demo = page.locator('[data-demo-appearance]');
    assert.equal(await header.getAttribute('data-scrolled'),null,`${name}: static upper band on load`);
    assert.equal(await panel.isVisible(),false,`${name}: lower band hidden on load`);
    assert.equal(await demo.getAttribute('data-demo-appearance'),'pending',`${name}: demo pending on load`);
    assert.equal(await page.locator('[data-peek-js=true]').count(),0,`${name}: demo not enhanced on load`);
    assert.equal(await page.locator('#problem').count(),0,`${name}: old second block absent`);
    assert.equal(await page.locator('#hero [data-hero-visual]').count(),1,`${name}: hero art retained`);
    await page.screenshot({path:path.join(out,`${name}-load.png`)});

    await page.mouse.move(viewport.width-24,viewport.height-36);
    await page.mouse.wheel(0,120);
    await page.waitForFunction(()=>document.querySelector('[data-test=header]')?.dataset.scrolled==='true');
    await page.waitForTimeout(500);
    assert.equal(await panel.isVisible(),true,`${name}: lower band reveals on trusted wheel`);
    assert.ok(Math.abs((await panel.boundingBox()).y)<2,`${name}: panel sticks at top`);
    await page.screenshot({path:path.join(out,`${name}-header-scroll.png`)});
    await page.mouse.wheel(0,-120);
    await page.waitForFunction(()=>scrollY===0);
    await panel.waitFor({state:'hidden'});
    assert.equal(await header.getAttribute('data-scrolled'),null,`${name}: header restores at top`);
    assert.equal(await panel.isVisible(),false,`${name}: lower band restores at top`);

    const checkpoints = [];
    const demoTop = await demo.evaluate(node=>node.getBoundingClientRect().top+scrollY);
    for (let step=0;step<24;step++) {
      await page.mouse.wheel(0,120);
      await page.waitForTimeout(220);
      const state = await page.evaluate(()=>({y:scrollY,top:document.querySelector('[data-demo-appearance]').getBoundingClientRect().top,state:document.querySelector('[data-demo-appearance]').dataset.demoAppearance,header:document.querySelector('[data-test=header]').dataset.scrolled}));
      checkpoints.push(state);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),`${name}: wheel overflow`);
      if (state.state==='visible') break;
    }
    assert.equal(checkpoints.at(-1).state,'visible',`${name}: actual wheel reveals demo`);
    assert.ok(checkpoints.at(-1).y<demoTop,`${name}: reveal occurs as second scene enters, not deeper`);
    assert.equal(await page.locator('[data-peek-js=true]').count(),1,`${name}: wheel starts native enhancement`);
    await page.waitForTimeout(700);
    await page.screenshot({path:path.join(out,`${name}-wheel-entrance.png`)});
    // Finish bringing the whole miniature into the camera with the same wheel.
    for (let step=0;step<30 && await demo.evaluate(node=>node.getBoundingClientRect().top)>180;step++) {
      await page.mouse.wheel(0,100); await page.waitForTimeout(150);
    }
    assert.ok(await demo.evaluate(node=>node.getBoundingClientRect().top)<=180,`${name}: bounded wheel reaches demo`);
    await page.waitForTimeout(800);
    let desktopCamera;
    if (name==='desktop') {
      const handle=page.locator('[data-peek-handle]');
      // Keep the invisible native handle below the fixed nav; otherwise
      // Playwright's actionability scroll moves it to the viewport bottom.
      await handle.hover();
      await page.waitForFunction(()=>document.querySelector('[data-demo-peek]')?.dataset.peekState==='full');
      await handle.focus();
      await page.waitForTimeout(600);
      desktopCamera = await page.evaluate(()=>({y:scrollY,workflow:document.querySelector('[data-hero-workflow]').getBoundingClientRect().toJSON(),peek:document.querySelector('[data-demo-peek]').dataset.peekState}));
      console.log(JSON.stringify({name,desktopCamera}));
      assert.ok(desktopCamera.workflow.y<viewport.height && desktopCamera.workflow.bottom>80,'desktop: recorded expanded workflow is inside camera');
      await page.screenshot({path:path.join(out,'desktop-wheel-demo-expanded.png')});
      await page.locator('#hero-workflow-tab-2').click();
      await page.waitForFunction(()=>document.querySelector('[data-hero-workflow]')?.dataset.activeStage==='2');
      await page.locator('#hero-workflow-tab-2').focus();
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.querySelector('[data-demo-peek]')?.dataset.peekState==='peek');
      assert.equal(await handle.evaluate(node=>node===document.activeElement),true,'desktop: Escape restores handle focus');
    }
    if (name !== 'desktop') {
      const summary=page.locator('[data-header-panel] summary');
      await summary.tap();
      assert.equal(await summary.evaluate(node=>node.parentElement.open),true,`${name}: touch menu opens`);
      await page.screenshot({path:path.join(out,`${name}-menu-open.png`)});
      await summary.focus(); await page.keyboard.press('Escape');
      assert.equal(await summary.evaluate(node=>node.parentElement.open),false,`${name}: Escape closes menu`);
      assert.equal(await summary.evaluate(node=>node===document.activeElement),true,`${name}: Escape retains focus`);
      await summary.tap();
      await page.locator('[data-header-panel] details a[href="#card"]').tap();
      await page.waitForTimeout(600);
      assert.equal(await summary.evaluate(node=>node.parentElement.open),false,`${name}: selection closes menu`);
      assert.equal(await page.locator('#card').evaluate(node=>node===document.activeElement),true,`${name}: selection parks focus on visible section`);
      const heading=await page.locator('#card h2').boundingBox();
      const nav=await panel.boundingBox();
      assert.ok(heading.y>=nav.y+nav.height,`${name}: anchor heading not obscured by panel`);
      await page.screenshot({path:path.join(out,`${name}-anchored-card.png`)});
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>document.activeElement.tagName==='BODY'),false,`${name}: keyboard proceeds from destination`);
    }
    assert.deepEqual(errors,[],`${name}: normal-motion errors`);
    const video=page.video();
    await context.close();
    await video.saveAs(path.join(out,`${name}-wheel-motion.webm`));
    results.push({name,viewport,input:'trusted browser mouse.wheel',demoTop,checkpoints,desktopCamera,header:'load→scroll→top verified',mobileMenu:name!=='desktop'?'touch/Escape/anchor focus pass':undefined,errors});
  }
  await fs.writeFile(path.join(out,'wheel-report.json'),JSON.stringify(results,null,2));
  return results;
}
