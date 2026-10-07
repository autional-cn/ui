#!/usr/bin/env node
// probe-live-overlay —— 线上浮层探针（第 63 轮补·四）
// 用法: node scripts/probe-live-overlay.mjs [url] [--json]
//
// 为什么留在仓库里：第 63 轮补·四那个「黑色遮罩怪怪的」是**只有真浏览器能量出来**的一类问题 ——
// 类名对、颜色对、静态闸门全绿，而遮罩只覆盖了 976x135（因为顶栏的 backdrop-filter 成了
// position:fixed 的包含块）。静态判据看不见它，视觉基线也不会**自己**去点搜索按钮。
// 所以这里把「点开线上的浮层，量它的计算样式与几何」固化成一个可重复的动作。
//
// 判据（人看的三行）：
//   遮罩 rect 必须等于视口（1440x900 这种），且**是 document.body 的直接子节点**；
//   背景色必须来自设计系统（--color-bg-scrim = rgb(10 15 26)），不是纯黑；
//   面板的 padding-top / 偏移类所用令牌必须解析成非 0（否则就是 CDN 变量没到位）。

import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || 'https://www.autional.cn/';
const asJson = args.includes('--json');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const scripts = [];
page.on('response', (r) => { if (/\.js(\?|$)/.test(r.url())) scripts.push(r.url()); });
await page.goto(url, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(1200);

let opened = false;
for (const sel of ['button[aria-label="搜索"]', 'button:has-text("搜索")', 'button[aria-label="Search"]']) {
  try { await page.click(sel, { timeout: 3000 }); opened = true; break; } catch {}
}
await page.waitForTimeout(900);

const overlay = await page.evaluate(() => {
  const els = [...document.querySelectorAll('div')].filter((el) => {
    const cs = getComputedStyle(el);
    return cs.position === 'fixed' && el.getBoundingClientRect().width > 300 && /scrim|black/.test((el.className || '').toString());
  });
  return els.map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      cls: (el.className || '').toString().slice(0, 100),
      background: cs.backgroundColor,
      backdrop: cs.backdropFilter,
      rect: Math.round(r.width) + 'x' + Math.round(r.height),
      isBodyChild: el.parentElement === document.body,
    };
  });
});

let bundleHasScrim = false;
let bundleHasBlack = false;
for (const u of scripts.filter((x) => x.includes('/_astro/') || x.includes('/assets/'))) {
  try {
    const b = await (await page.request.get(u)).text();
    if (b.includes('bg-scrim')) bundleHasScrim = true;
    if (b.includes('bg-black/50')) bundleHasBlack = true;
  } catch {}
}
await browser.close();

const report = { url, opened, overlay, bundleHasScrim, bundleHasBlack, scripts: scripts.length };
if (asJson) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
console.log('探针：' + url + '（搜索入口 ' + (opened ? '已点开' : '未找到/未点开') + '）');
for (const o of overlay) {
  const full = o.rect === '1440x900';
  console.log('  遮罩 ' + o.rect + (full ? ' ✓ 整屏' : ' ✗ 未覆盖视口') + ' · ' + o.background + ' · body 直接子节点=' + o.isBodyChild);
  console.log('        class = ' + o.cls);
}
if (!overlay.length) console.log('  （没找到 fixed 遮罩层）');
console.log('  bundle 含 bg-scrim = ' + bundleHasScrim + ' · 含 bg-black/50 = ' + bundleHasBlack);
console.log(bundleHasScrim ? '  结论：线上是**含本轮修复**的构建' : '  结论：线上仍是**修复之前**的构建（bundle 里还是 bg-black/50）');
