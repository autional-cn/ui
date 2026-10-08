#!/usr/bin/env node
// check-fixed-containment — 浮层包含块闸门（verify 第 31 道）
// 用法: node scripts/check-fixed-containment.mjs [--json] [--selftest] [--write-baseline]
//
// 为什么需要它（同一个坑，一天之内踩了两次）：
//   第 63 轮补·四线上实测到 www 的搜索遮罩只有 **976×135** 而不是 1440×900 ——
//   顶栏内层有 `backdrop-blur`，而 `backdrop-filter` 会为 `position: fixed` 的后代**建立包含块**，
//   于是 `inset-0` 变成了「覆盖顶栏那一条」。用户先看见（"弹出一个黑色遮罩，怪怪的"）。
//   补·六 当天，`web` 站的返回顶部按钮又被**同一个机制**钉在页面顶部（导航胶囊的 backdrop-filter）。
//   两次都是：**类名对、颜色对、编译得过、静态闸门全绿**，只有真浏览器能量出来。
//
// 判据（CSS 规范的直接推论，不是经验规则）：
//   `position: fixed` 的包含块默认是**视口**；只要最近的祖先里有建立包含块的属性
//   （transform / perspective / filter / backdrop-filter / will-change 命中前四者 / contain: paint|layout|strict|content），
//   包含块就变成那个祖先。此时「满屏意图」的浮层不再满屏 —— 这是**结构性错误**，与具体像素无关。
//
// 两级判定（避免一刀切带来假阳性）：
//   ① 满屏意图（computed inset 四边皆为 0）+ 有包含块祖先 ⇒ **失败**（这就是那两次事故的形态）；
//   ② 其余 fixed 元素 + 有包含块祖先 ⇒ **棘轮**（可能是刻意的，例如取景框内部的浮层）：
//      基线在 verification/fixed-containment.json，只许减；新出现的要显式登记。
//
// 目标页来自 verification/visual.targets.json（与视觉/对比度闸门同一批页面，口径一致）。
// 无 chromium / 无产物时跳过（与其他浏览器闸门同一约定）。

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { ROOT } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const SELFTEST = process.argv.includes('--selftest');
const WRITE_BASELINE = process.argv.includes('--write-baseline');
// AUTIONAL_FIXED_TARGETS 用于测试注入（与其它闸门同一套约定）
const CFG_PATH = process.env.AUTIONAL_FIXED_TARGETS || join(ROOT, 'verification', 'visual.targets.json');
const BASELINE_PATH = join(ROOT, 'verification', 'fixed-containment.json');

// ── 页面内探针：返回所有「包含块不是视口」的 fixed 元素 ───────────────────────
const PROBE = () => {
  // 建立包含块的属性（CSS Containment / Transforms 规范里对 fixed 后代生效的那几个）
  const blockersOf = (cs) => {
    const out = [];
    if (cs.transform && cs.transform !== 'none') out.push('transform');
    if (cs.perspective && cs.perspective !== 'none') out.push('perspective');
    if (cs.filter && cs.filter !== 'none') out.push('filter');
    if (cs.backdropFilter && cs.backdropFilter !== 'none') out.push('backdrop-filter');
    if (cs.willChange && /transform|perspective|filter|contain/.test(cs.willChange)) out.push('will-change:' + cs.willChange);
    if (cs.contain && /paint|layout|strict|content/.test(cs.contain)) out.push('contain:' + cs.contain);
    return out;
  };
  const items = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') continue;
    if (el.getClientRects().length === 0) continue;          // 没渲染 = 不是样本
    let hit = null;
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const b = blockersOf(getComputedStyle(node));
      if (b.length) {
        hit = { prop: b.join('+'), tag: node.tagName.toLowerCase(), cls: String(node.className || '').slice(0, 60) };
        break;
      }
      node = node.parentElement;
    }
    if (!hit) continue;
    // 满屏意图：computed inset 四边都为 0（inset-0 / 等价写法）
    const zero = (v) => v === '0px';
    const coverIntent = zero(cs.top) && zero(cs.right) && zero(cs.bottom) && zero(cs.left);
    const r = el.getBoundingClientRect();
    items.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 90),
      role: el.getAttribute('role') || '',
      coverIntent,
      blocker: hit,
      rect: [Math.round(r.width), Math.round(r.height)],
      viewport: [window.innerWidth, window.innerHeight],
    });
  }
  return items;
};

const keyOf = (it) => it.tag + '|' + (it.cls || '(no-class)');

// ── 自检：离线探针页（不需要任何站点产物）正负对照 ──────────────────────────
if (SELFTEST) {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  let chromium = null;
  try { chromium = (await import('playwright-core')).chromium; } catch (e) { chromium = null; }
  if (!chromium) { console.log('check-fixed-containment --selftest：没有 playwright-core，跳过'); process.exit(0); }
  const dir = mkdtempSync(join(tmpdir(), 'fixed-containment-'));
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0 }
    .box { width: 40px; height: 40px; background: #333 }
    .bar { backdrop-filter: blur(4px); height: 60px }
    .tf { transform: translateZ(0) }
    .plain { transform: none }
    .willc { will-change: transform }
    .rel { position: relative }
    .fixedParent { position: fixed; top: 200px; left: 200px; width: 100px; height: 100px }
  </style></head><body>
    <!-- 正例①：满屏意图 + backdrop-filter 祖先（= 线上那两次事故的形态） -->
    <div class="bar"><div id="p1" class="box" style="position: fixed; inset: 0; background: rgba(0,0,0,.5)"></div></div>
    <!-- 正例②：会动的浮标 + transform 祖先（棘轮那一类） -->
    <div class="tf"><div id="p2" class="box" style="position: fixed; top: 8px; left: 8px"></div></div>
    <!-- 正例③：will-change: transform 也算（容易被漏掉的一个） -->
    <div class="willc"><div id="p3" class="box" style="position: fixed; top: 8px; left: 8px"></div></div>
    <!-- 负例①：没有任何包含块祖先 -->
    <div id="n1" class="box" style="position: fixed; inset: 0; background: rgba(0,0,0,.5)"></div>
    <!-- 负例②：transform: none 不建立包含块 -->
    <div class="plain"><div id="n2" class="box" style="position: fixed; top: 8px; left: 8px"></div></div>
    <!-- 负例③：普通 positioned 祖先（relative）**不**为 fixed 建立包含块 —— 朴素规则会在这里误报 -->
    <div class="rel"><div id="n3" class="box" style="position: fixed; top: 8px; left: 8px"></div></div>
    <!-- 负例④：fixed 祖先本身也不建立包含块（fixed 套 fixed 仍然相对视口） -->
    <div class="fixedParent"><div id="n4" class="box" style="position: fixed; top: 8px; left: 8px"></div></div>
  </body></html>`);
  const { serveStatic } = await import('./lib/static-server.mjs');
  const server = await serveStatic(dir, 0);
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
  const found = await page.evaluate(PROBE);
  await browser.close();
  server.close();
  const seen = new Map(found.map((f) => [f.cls.includes('p1') ? 'p1' : f.cls.includes('p2') ? 'p2' : f.cls.includes('p3') ? 'p3' : '?', f]));
  // 用 id 更可靠：探针里 cls 是 class 名，id 不在其中 —— 改为按 rect/顺序匹配太脆，这里直接断言数量与意图
  const covers = found.filter((f) => f.coverIntent).length;
  const others = found.filter((f) => !f.coverIntent).length;
  const probes = [
    ['正例① 满屏意图 + backdrop-filter 祖先 → 判失败', covers >= 1],
    ['正例② transform 祖先的浮标 → 进棘轮', others >= 2],
    ['负例①②③④ 共 4 个不该命中', found.length <= 3],
    ['探针能读回视口尺寸', found.every((f) => f.viewport[0] > 0 && f.viewport[1] > 0)],
  ];
  let bad = 0;
  for (const [label, ok] of probes) { if (!ok) bad++; console.log((ok ? '  ok   ' : '  FAIL ') + label); }
  console.log('  （探针命中 ' + found.length + ' 个：满屏意图 ' + covers + ' · 其他 ' + others + '）');
  console.log(bad ? '自检：' + bad + ' 条不符' : '自检：' + probes.length + '/' + probes.length + ' 通过');
  process.exit(bad ? 1 : 0);
}

// ── 正式跑：目标页 × 真实 chromium ──────────────────────────────────────────
if (!existsSync(CFG_PATH)) { console.log('check-fixed-containment：缺少 verification/visual.targets.json'); process.exit(2); }
const CFG = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
const BASELINE = existsSync(BASELINE_PATH) ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).entries || {}) : {};

let chromium = null;
try { chromium = (await import('playwright-core')).chromium; } catch (e) { chromium = null; }
let browser = null;
if (chromium) { try { browser = await chromium.launch(); } catch (e) { browser = null; } }
if (!browser) { console.log('check-fixed-containment：无可用 chromium，跳过（先 pnpm install 并确保有浏览器）'); process.exit(0); }

const { serveStatic } = await import('./lib/static-server.mjs');

const problems = [];
const current = {};       // "<target>|<tag>|<class>" -> 次数
const perTarget = [];
let skipped = 0;
for (const t of CFG.targets || []) {
  const root = resolve(ROOT, t.root);
  if (!existsSync(root)) { skipped++; continue; }
  const server = await serveStatic(root, 0);
  const port = server.address().port;
  const ctx = await browser.newContext({ viewport: CFG.viewport, deviceScaleFactor: 1, locale: CFG.locale, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  let items = [];
  try {
    await page.goto('http://127.0.0.1:' + port + t.path, { waitUntil: 'load', timeout: 45000 });
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch (e) { /* 长连接站点属正常 */ }
    await page.waitForTimeout(CFG.settleMs || 1500);
    // 取数分两轮：**首屏** + **滚到底**。
    // 为什么要滚：返回顶部 / 悬浮操作条这一类 fixed 浮标是「滚动后才出现或才位移」的，
    // 只在首屏量会漏掉整整一类 —— 而补·六 那次事故（返回顶部按钮被导航胶囊的 backdrop-filter
    // 钉在页面顶部）正是这一类。滚到底是通用动作，不需要认识任何站点的交互。
    const scan = async () => {
      try { return await page.evaluate(PROBE); } catch (e) { return []; }
    };
    items = await scan();
    try {
      await page.evaluate(() => window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)));
      await page.waitForTimeout(600);
      const after = await scan();
      const seen = new Set(items.map((i) => i.tag + '|' + i.cls + '|' + i.blocker.cls));
      for (const a of after) if (!seen.has(a.tag + '|' + a.cls + '|' + a.blocker.cls)) items.push(a);
      await page.evaluate(() => window.scrollTo(0, 0));
    } catch (e) { /* 滚动失败不影响首屏结论 */ }
  } catch (e) {
    problems.push('FC0 ' + t.name + '：页面加载/取数失败（' + String(e.message).slice(0, 80) + '）');
  } finally {
    await ctx.close();
    server.close();
  }
  if (!items.length) continue;
  perTarget.push({ target: t.name, count: items.length, covers: items.filter((i) => i.coverIntent).length });
  for (const it of items) {
    const key = t.name + '|' + keyOf(it);
    current[key] = (current[key] || 0) + 1;
    if (it.coverIntent) {
      problems.push('FC1 ' + t.name + '：满屏意图的 fixed 浮层被祖先「' + it.blocker.prop + '」建立了包含块（<' +
        it.blocker.tag + ' class="' + it.blocker.cls + '">）⇒ 它锚定的是那个祖先而不是视口' +
        '（实测 ' + it.rect[0] + '×' + it.rect[1] + '，视口 ' + it.viewport[0] + '×' + it.viewport[1] + '）。' +
        '元素：<' + it.tag + (it.cls ? ' class="' + it.cls + '"' : '') + '>。' +
        '修法：createPortal(…, document.body) —— 浮层属于顶层，不属于触发它的子树（注意事项 50）');
    }
  }
}

// 棘轮比对（非满屏意图的那一类）
const grown = [];
for (const [key, n] of Object.entries(current)) {
  const base = BASELINE[key] || 0;
  if (n > base) grown.push({ key, n, base });
}
for (const g of grown) {
  problems.push('FC2 新增固定定位 + 包含块祖先的组合（棘轮）：' + g.key + '（现值 ' + g.n + '，基线 ' + g.base + '）' +
    ' —— 若确属刻意（例如取景框内的浮层），跑 --write-baseline 登记；否则请 portal 到 body');
}

if (WRITE_BASELINE) {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify({
    $note: '浮层包含块棘轮（第 31 道闸门的 FC2 类）：只许减。生成方式 node scripts/check-fixed-containment.mjs --write-baseline',
    generatedAt: new Date().toISOString(),
    entries: Object.fromEntries(Object.entries(current).sort()),
  }, null, 2) + '\n');
  console.log('已写入基线 ' + BASELINE_PATH + '（' + Object.keys(current).length + ' 条）');
}

if (AS_JSON) {
  console.log(JSON.stringify({ perTarget, current, problems }, null, 2));
} else {
  console.log('浮层包含块闸门：' + (CFG.targets || []).length + ' 个目标' + (skipped ? '（' + skipped + ' 个无产物，跳过）' : ''));
  for (const p of perTarget) console.log('  ' + p.target.padEnd(24) + ' 固定定位元素 ' + String(p.count).padStart(3) + ' 个（其中满屏意图 ' + p.covers + '）');
  if (!problems.length) console.log('\n结论：没有 fixed 浮层被祖先的包含块吃掉（满屏意图 0 处 · 棘轮无新增）');
  else { console.log(''); for (const p of problems) console.log('  [ERROR] ' + p); console.log('结论：' + problems.length + ' 项'); }
}
await browser.close();
process.exit(problems.length ? 1 : 0);
