import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('https://www.autional.cn/', { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(1200);
for (const sel of ['button[aria-label="搜索"]', 'button:has-text("搜索")']) {
  try { await page.click(sel, { timeout: 3000 }); break; } catch {}
}
await page.waitForTimeout(900);
const chain = await page.evaluate(() => {
  const input = document.querySelector('input[placeholder]');
  if (!input) return 'no input';
  const out = [];
  let el = input;
  for (let i = 0; i < 8 && el; i++) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out.push({
      lvl: i,
      tag: el.tagName,
      cls: (el.className || '').toString().slice(0, 110),
      pos: cs.position,
      bg: cs.backgroundColor,
      backdrop: cs.backdropFilter !== 'none' ? cs.backdropFilter : '-',
      z: cs.zIndex,
      rect: Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height),
      padTop: cs.paddingTop,
      opacity: cs.opacity,
    });
    el = el.parentElement;
  }
  return out;
});
if (typeof chain === 'string') console.log(chain);
else for (const c of chain) console.log(JSON.stringify(c));
await browser.close();
