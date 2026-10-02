#!/usr/bin/env node
// check-contrast — 站点级 WCAG AA 对比度闸门（verify 第 18 道）
// 用法: node scripts/check-contrast.mjs [--json]
//
// 为什么需要它（U66 第⑪项）：
//   令牌 lint 已经按 roles 断言了「令牌对令牌」的对比度（contrast-pairs.json），
//   但它看不见**站点实际渲染出来的**那一对颜色。实测缺口：
//   www 的 hero 第二行用 \`text-sky-500\` 铺在浅色底上 ≈ 1.68:1 ——
//   大字号要 3:1、正文要 4.5:1，两个都不够，而三道相关闸门全绿：
//     · lint-tokens 只看令牌对，sky-500 不是任何语义角色；
//     · check-classnames 的 K2 能把这种类名找出来，但它当时只是**提示**，不判失败；
//     · 视觉回归管「有没有变」，不管「够不够看得清」。
//   所以把 K2 那一类从「提示」升级成「在真实页面上量出来的失败」。
//
// 判据来源：WCAG 2.1 1.4.3（正文 4.5:1；大号文本 3:1）。
//   大号 = 24px 及以上，或 18.66px(14pt) 及以上且字重 >= 700。
//
// 只处理**确定性可算**的情况，不做假阳性：
//   · 元素必须直接包含非空文本；
//   · 有效背景取「自身或最近祖先里第一个不透明背景色」；
//     若这段祖先链上有 background-image（含渐变）或 backdrop-filter，则**跳过并计数**——
//     那需要真实像素采样，静态算不出来，硬算就是编。
//   · 前景/背景带 alpha 时按 alpha 合成后再算。
//
// 目标页来自 verification/visual.targets.json（与视觉回归同一批页面，口径一致）。
// 豁免写在 verification/contrast-exemptions.json，每条必须有 reason / owner / expires。

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
// AUTIONAL_CONTRAST_TARGETS 用于测试注入（与其它闸门同一套约定）
const CFG_PATH = process.env.AUTIONAL_CONTRAST_TARGETS || join(ROOT, 'verification', 'visual.targets.json');
const EXEMPT_PATH = join(ROOT, 'verification', 'contrast-exemptions.json');
const KNOWN_PATH = join(ROOT, 'verification', 'known-issues.json');

const problems = [];
// 零样本**刻意不走 problems**：problems 会被 known-issues 的子串匹配吞掉，
// 而"这个目标什么都没渲染"是**闸门自身的配置缺陷**，不是产品缺陷 ——
// 用一张产品侧的登记单来掩盖"我们没在量东西"是错的。
// 实测踩到过：KI-015 的 match 写成 "AA1 admin-console"（粒度太粗，
// 违反 known-issues 自己的规则），把我新加的零样本报错整条吞了，闸门照样打印"全部达到 AA"。
const zeroSample = [];
const warns = [];
const info = [];

if (!existsSync(CFG_PATH)) { console.log('check-contrast：缺少 verification/visual.targets.json'); process.exit(2); }
const CFG = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
const KNOWN = existsSync(KNOWN_PATH) ? (JSON.parse(readFileSync(KNOWN_PATH, 'utf8')).issues || []).filter((k) => k.code === 'AA1') : [];
const EXEMPT = existsSync(EXEMPT_PATH) ? (JSON.parse(readFileSync(EXEMPT_PATH, 'utf8')).entries || []) : [];
const today = new Date().toISOString().slice(0, 10);

let chromium = null;
try { chromium = (await import('playwright-core')).chromium; } catch (e) { chromium = null; }
let browser = null;
if (chromium) { try { browser = await chromium.launch(); } catch (e) { browser = null; } }
if (!browser) {
  console.log('check-contrast：无可用 chromium，跳过（先 pnpm install 并确保有浏览器）');
  process.exit(0);
}

const { serveStatic } = await import('./lib/static-server.mjs');

// 页面内取数：返回每一段「有直接文本」的元素的 前景/背景/字号/字重
const PROBE = () => {
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(',').map((s) => parseFloat(s.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  });
  const out = [];
  let skippedGradient = 0;
  for (const el of document.querySelectorAll('body *')) {
    let hasText = false;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { hasText = true; break; }
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    // 有效背景：向上找第一个不透明背景；途中遇到图像/模糊就放弃
    let bg = null;
    let node = el;
    let blocked = false;
    while (node && node !== document.documentElement.parentElement) {
      const s = getComputedStyle(node);
      if (s.backgroundImage && s.backgroundImage !== 'none') { blocked = true; break; }
      if (s.backdropFilter && s.backdropFilter !== 'none') { blocked = true; break; }
      const c = parse(s.backgroundColor);
      if (c && c.a >= 0.95) { bg = c; break; }
      if (c && c.a > 0) { bg = bg ? over(bg, c) : c; }
      node = node.parentElement;
    }
    if (blocked) { skippedGradient++; continue; }
    if (!bg) { bg = { r: 255, g: 255, b: 255, a: 1 }; }   // 兜底：画布白
    const f = fg.a < 1 ? over(fg, bg) : fg;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    out.push({
      sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
      text: (el.textContent || '').trim().slice(0, 40),
      fg: [Math.round(f.r), Math.round(f.g), Math.round(f.b)],
      bg: [Math.round(bg.r), Math.round(bg.g), Math.round(bg.b)],
      size: Math.round(size * 10) / 10, weight, large
    });
  }
  return { items: out, skippedGradient };
};

const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

const targets = CFG.targets || [];
let port = 19060;
let checked = 0;
let skipped = 0;
const worst = [];
for (const t of targets) {
  const root = resolve(ROOT, t.root);
  if (!existsSync(root)) { warns.push('AA1 ' + t.name + '：产物目录不存在，跳过'); continue; }
  const server = await serveStatic(root, port++);
  const ctx = await browser.newContext({ viewport: CFG.viewport, deviceScaleFactor: 1, locale: CFG.locale, reducedMotion: 'reduce', colorScheme: 'light' });
  const page = await ctx.newPage();
  try {
    await page.goto('http://127.0.0.1:' + (port - 1) + t.path, { waitUntil: 'load', timeout: 45000 });
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.waitForTimeout(400);
    const res = await page.evaluate(PROBE);
    skipped += res.skippedGradient;

    // 零样本 = 没验，不是通过。这一条是补一个实际存在的假绿：
    // admin-console 的 target 指向 SPA 的 `/`，该页会尝试跳转 auth（依赖后端），
    // 于是渲染出来一段文本都没有 —— 闸门照样打印
    //   「AA1 admin-console：检查 0 段文本，全部达到 AA」+ 「结论：对比度全部达到 WCAG AA」
    // 假绿比红贵：它会在几十轮里一直掩盖真实缺陷。KI-015 登记的 3 处不达标
    // 就在这个目标上，而闸门用 0 段样本"通过"了它。
    //
    // 不引入新的豁免机制：走已有的 KNOWN（verification/known-issues.json，code=AA1），
    // 那条路径强制要求 owner 与 expires，口径与其它闸门一致。
    if (res.items.length === 0) {
      zeroSample.push('AA1 ' + t.name + '：0 段文本样本 —— 这个目标什么都没渲染，闸门无从判定。' +
        '零样本不是通过：把 target 换成一个真能渲染的路径，或者把它从 target 名单里去掉');
    }

    const bad = [];
    for (const it of res.items) {
      checked++;
      const r = ratio(it.fg, it.bg);
      const need = it.large ? 3 : 4.5;
      if (r + 1e-9 < need) bad.push({ ...it, ratio: Math.round(r * 100) / 100, need });
    }
    worst.push(...bad.map((b) => ({ target: t.name, ...b })));
    if (bad.length) {
      const exempt = EXEMPT.filter((e) => e.target === t.name && (b => String(b.sel).indexOf(e.match) >= 0 || e.match === '*'));
      const unexempt = bad.filter((b) => !EXEMPT.some((e) => e.target === t.name && (e.match === '*' || String(b.sel).indexOf(e.match) >= 0)));
      info.push('AA1 ' + t.name + '：检查 ' + res.items.length + ' 段文本，' + bad.length + ' 段低于 AA' +
        (bad.length - unexempt.length ? '（其中 ' + (bad.length - unexempt.length) + ' 段已豁免）' : ''));
      for (const b of unexempt.slice(0, 12)) {
        problems.push('AA1 ' + t.name + '：' + b.sel + ' 「' + b.text + '」 对比度 ' + b.ratio + ':1 < ' + b.need +
          ':1（前景 rgb(' + b.fg.join(',') + ') 对背景 rgb(' + b.bg.join(',') + ')，' + b.size + 'px/' + b.weight +
          (b.large ? ' 大号' : ' 正文') + '）');
      }
    } else {
      info.push('AA1 ' + t.name + '：检查 ' + res.items.length + ' 段文本，全部达到 AA');
    }
  } catch (e) {
    warns.push('AA1 ' + t.name + '：断言失败 ' + String(e.message || e).slice(0, 90));
  }
  await ctx.close();
  server.close();
}
await browser.close();

const active = [...zeroSample];   // 零样本不可豁免，直接进失败列表
for (const p of problems) {
  const k = KNOWN.find((x) => p.indexOf(x.match) >= 0);
  if (k) info.push('AA1 已登记（' + k.id + '）：' + p.slice(0, 100)); else active.push(p);
}
for (const e of EXEMPT) {
  for (const f of ['id', 'target', 'match', 'reason', 'owner', 'expires']) if (!e[f]) active.push('AA9 豁免 ' + (e.id || '?') + ' 缺少字段 ' + f);
  if (e.expires && e.expires < today) active.push('AA9 豁免 ' + e.id + ' 已过期（' + e.expires + '）：要么修掉，要么重新评估并续期');
}

if (AS_JSON) {
  console.log(JSON.stringify({ targets: targets.length, checked, skipped, active, warns, info }, null, 2));
} else {
  console.log('对比度 AA 闸门：' + targets.length + ' 个目标页 / 检查 ' + checked + ' 段文本' +
    (skipped ? '（另有 ' + skipped + ' 段因背景是图像或渐变而无法静态判定，已跳过）' : ''));
  console.log('');
  for (const i of info) console.log('  [INFO ] ' + i);
  for (const w of warns) console.log('  [WARN ] ' + w);
  for (const a of active) console.log('  [ERROR] ' + a);
  console.log('');
  console.log(active.length ? '结论：有 ' + active.length + ' 处对比度不达 AA' : '结论：对比度全部达到 WCAG AA');
}
process.exit(active.length ? 1 : 0);
