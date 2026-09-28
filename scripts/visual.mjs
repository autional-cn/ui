#!/usr/bin/env node
// visual — 站点视觉回归：把「改完看起来对不对」变成可回归的基线
// 用法: node scripts/visual.mjs baseline | check
//
// 与 brandui 的 visual.mjs 同构，目标改成真实站点的构建产物（静态托管，不起 dev server）。
//
// ⚠️ **读差异百分比时要知道它极度敏感于亚像素位移。**
// 实测（2026-09-29，刻意做的 A/B）：把**一个段落**的行高从 31.5px 改成 32px
// （差 0.5px，肉眼不可辨），整页差异就有 **2.250%**、SSIM 0.9516（低于 0.98 阈值）。
// 原因是首屏元素的行高变化会让**整页内容随之移动**，长页面上亚像素重排会大面积
// 改变抗锯齿结果。
// 含义：**一个很大的百分比不等于一个很大的视觉变化。** 判断「这次改动是不是有意的」
// 要看改了哪些令牌，而不是看差异数字的大小；反过来，一个很小的百分比也未必无变化。
// 我在这上面栽过：把一次 8.385% 的差异先归因于颜色、又归因于 max-width，两次都错，
// 真正的原因是行高差 0.5px。
//
// 三条实测教训（都已固化进实现）：
//   1) 每个目标必须用**全新 chromium 进程**采集。复用同一进程时同一页面出现过两种渲染。
//   2) 缺文件不能一律回退 index.html（详见 lib/static-server.mjs 的注释）。
//   3) 基线绑定浏览器版本 + 视口 + DPR + 平台 + 本机字体，跨机器复用必然误报。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { decodePng, encodePng, colorDelta, ssim8x8 } from './lib/png.mjs';
import { serveStatic } from './lib/static-server.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CFG_PATH = join(ROOT, 'verification', 'visual.targets.json');
const BASE_DIR = join(ROOT, 'verification', 'baselines');
const DIFF_DIR = join(ROOT, 'verification', 'diffs');
const KNOWN_PATH = join(ROOT, 'verification', 'known-issues.json');

const CFG = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
const KNOWN = existsSync(KNOWN_PATH) ? (JSON.parse(readFileSync(KNOWN_PATH, 'utf8')).issues || []).filter((k) => k.code === 'V1') : [];
const today = new Date().toISOString().slice(0, 10);

const FREEZE = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }';

async function capture(target, port) {
  const root = resolve(ROOT, target.root);
  if (!existsSync(root)) return { skipped: true, reason: '产物目录不存在：' + target.root };
  let chromium;
  try { chromium = (await import('playwright-core')).chromium; }
  catch (e) { return { skipped: true, reason: '未安装 playwright-core（先 pnpm install）' }; }
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { return { skipped: true, reason: '无可用 chromium：' + String(e.message || e).slice(0, 90) }; }

  const server = await serveStatic(root, port);
  const context = await browser.newContext({
    viewport: CFG.viewport,
    deviceScaleFactor: CFG.deviceScaleFactor,
    locale: CFG.locale,
    timezoneId: CFG.timezoneId,
    reducedMotion: 'reduce',
    colorScheme: 'light'
  });
  const page = await context.newPage();
  const failures = [];
  page.on('response', (r) => { if (r.status() >= 400) failures.push(r.status() + ' ' + r.url().replace('http://127.0.0.1:' + port, '')); });
  try {
    await page.goto('http://127.0.0.1:' + port + target.path, { waitUntil: 'load', timeout: 45000 });
    await page.addStyleTag({ content: FREEZE });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map((i) => (i.decode ? i.decode().catch(() => {}) : Promise.resolve())));
    });
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch (e) { /* 长连接站点属正常 */ }
    await page.waitForTimeout(CFG.settleMs);
    const buf = await page.screenshot({ caret: 'hide', animations: 'disabled', scale: 'css' });
    return { buf, env: { browser: browser.version(), viewport: CFG.viewport, dpr: CFG.deviceScaleFactor, platform: process.platform, node: process.version }, failures };
  } finally {
    await browser.close();
    server.close();
  }
}

function diff(actual, baseline) {
  const a = decodePng(actual), b = decodePng(baseline);
  if (a.width !== b.width || a.height !== b.height) return { ok: false, reason: '尺寸不一致 ' + a.width + 'x' + a.height + ' vs ' + b.width + 'x' + b.height };
  const n = a.width * a.height;
  const maxDelta = 35215 * CFG.pixelThreshold * CFG.pixelThreshold;
  const out = new Uint8Array(n * 4);
  let changed = 0, worst = 0;
  for (let i = 0; i < n; i++) {
    const d = i * 4;
    const delta = Math.abs(colorDelta(a.data[d], a.data[d + 1], a.data[d + 2], a.data[d + 3], b.data[d], b.data[d + 1], b.data[d + 2], b.data[d + 3]));
    if (delta > worst) worst = delta;
    if (delta > maxDelta) { changed++; out[d] = 255; out[d + 1] = 0; out[d + 2] = 0; out[d + 3] = 255; }
    else { const g = Math.round(0.299 * b.data[d] + 0.587 * b.data[d + 1] + 0.114 * b.data[d + 2]); out[d] = g; out[d + 1] = g; out[d + 2] = g; out[d + 3] = 255; }
  }
  const ratio = changed / n;
  const ssim = ssim8x8(a.data, b.data, a.width, a.height);
  return { ok: ratio <= CFG.maxDiffPixelRatio && ssim >= CFG.minSsim, ratio, changed, total: n, ssim, worstDelta: worst, diffPng: encodePng(a.width, a.height, out) };
}

const cmd = process.argv[2] || 'check';
// --target <名字> 限定单个目标（可重复）。
// 为什么必须支持：重新采集基线是**逐个决定**的事。某个站点做了一次有意的高度调整
// 之后应当只重采它自己；而同时另一个站点可能有别人的在飞改动，一并重采等于
// 把未经审阅的渲染烤进基线，这道闸门从此就失去意义。实测踩过这个岔路。
const ONLY_TARGETS = (() => {
  const out = [];
  process.argv.forEach((a, i) => { if (a === '--target' && process.argv[i + 1]) out.push(process.argv[i + 1]); });
  return out;
})();
const TARGETS = ONLY_TARGETS.length ? CFG.targets.filter((t) => ONLY_TARGETS.includes(t.name)) : CFG.targets;
if (ONLY_TARGETS.length && !TARGETS.length) {
  console.log('--target 没有匹配到任何目标：' + ONLY_TARGETS.join(', ') + '（可用：' + CFG.targets.map((t) => t.name).join(', ') + '）');
  process.exit(1);
}
mkdirSync(BASE_DIR, { recursive: true });
mkdirSync(DIFF_DIR, { recursive: true });

let port = 18900;
const results = [];
for (const target of TARGETS) {
  const cap = await capture(target, port++);
  if (cap.skipped) { results.push({ name: target.name, action: 'skipped', reason: cap.reason }); continue; }
  const basePath = join(BASE_DIR, target.name + '.png');
  if (cmd === 'baseline') {
    writeFileSync(basePath, cap.buf);
    results.push({ name: target.name, action: 'baseline-written', bytes: cap.buf.length, sha256: createHash('sha256').update(cap.buf).digest('hex').slice(0, 16), env: cap.env, httpFailures: cap.failures });
    continue;
  }
  if (!existsSync(basePath)) { results.push({ name: target.name, action: 'no-baseline' }); continue; }
  const r = diff(cap.buf, readFileSync(basePath));
  const entry = { name: target.name, action: 'compared', ok: r.ok, ratio: r.ratio, changed: r.changed, total: r.total, ssim: r.ssim, worstDelta: r.worstDelta, reason: r.reason };
  if (!r.ok && r.diffPng) {
    writeFileSync(join(DIFF_DIR, target.name + '.diff.png'), r.diffPng);
    writeFileSync(join(DIFF_DIR, target.name + '.actual.png'), cap.buf);
    entry.diffImage = 'verification/diffs/' + target.name + '.diff.png';
  }
  results.push(entry);
}

if (cmd === 'baseline') {
  const first = results.find((r) => r.env);
  writeFileSync(join(BASE_DIR, 'MANIFEST.json'), JSON.stringify({
    $description: '视觉基线环境固化。跨机器复用基线与字体差异必然误报——本基线绑定下列环境。',
    generatedAt: new Date().toISOString(),
    config: { viewport: CFG.viewport, deviceScaleFactor: CFG.deviceScaleFactor, maxDiffPixelRatio: CFG.maxDiffPixelRatio, pixelThreshold: CFG.pixelThreshold, minSsim: CFG.minSsim },
    env: first ? first.env : null,
    results
  }, null, 2) + '\n');
  console.log('已写入视觉基线：');
  for (const r of results) {
    if (r.action === 'skipped') { console.log('  [跳过] ' + r.name + '  ' + r.reason); continue; }
    console.log('  ' + r.name.padEnd(18) + r.bytes + ' 字节  sha256=' + r.sha256 + (r.httpFailures && r.httpFailures.length ? '  4xx/5xx: ' + r.httpFailures.length + ' 个' : ''));
  }
  if (first) console.log('环境：chromium ' + first.env.browser + ' / ' + first.env.viewport.width + 'x' + first.env.viewport.height + ' @' + first.env.dpr + 'x / ' + first.env.platform);
  process.exit(0);
}

let failed = 0, knownFail = 0, skipped = 0;
console.log('视觉回归：' + TARGETS.length + ' 个目标' + (ONLY_TARGETS.length ? '（--target ' + ONLY_TARGETS.join(',') + '）' : ''));
for (const r of results) {
  if (r.action === 'skipped') { skipped++; console.log('  [跳过] ' + r.name + '  ' + r.reason); continue; }
  if (r.action === 'no-baseline') { failed++; console.log('  [缺失] ' + r.name + '：没有基线，先运行 node scripts/visual.mjs baseline'); continue; }
  const line = r.name.padEnd(18) + ' 差异像素 ' + r.changed + '/' + r.total + ' (' + (r.ratio * 100).toFixed(3) + '%)  SSIM ' + r.ssim.toFixed(4) + '  最大色差 ' + r.worstDelta.toFixed(0);
  if (r.ok) { console.log('  [PASS] ' + line); continue; }
  const k = KNOWN.find((x) => r.name.indexOf(x.match) >= 0 || x.match === 'visual');
  if (k) {
    knownFail++;
    if (k.expires && k.expires < today) { failed++; console.log('  [FAIL] ' + line + '  登记 ' + k.id + ' 已过期（' + k.expires + '）'); }
    else console.log('  [KNOWN] ' + line + '  已登记为 ' + k.id + '（到期 ' + k.expires + '）');
    continue;
  }
  failed++;
  console.log('  [FAIL] ' + line + (r.reason ? '  ' + r.reason : ''));
  if (r.diffImage) console.log('         差异图: ' + r.diffImage);
}
console.log('');
if (failed) { console.log('结论：视觉回归失败（' + failed + ' 项超阈）'); process.exit(1); }
if (knownFail) { console.log('结论：' + knownFail + ' 项超阈但已登记；' + skipped + ' 项目标跳过'); process.exit(0); }
console.log('结论：视觉回归通过' + (skipped ? '（' + skipped + ' 项目标因产物缺失或环境不可用跳过）' : ''));
process.exit(0);
