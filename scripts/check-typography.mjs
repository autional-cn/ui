#!/usr/bin/env node
// check-typography — 排版令牌的落地检查
// 用法: node scripts/check-typography.mjs [--json]
//
// 为什么需要这一层（实测，2026-09）：
//   颜色令牌在消费方产物里是 var(--color-*)，会随令牌走 —— sites/admin 的编译产物里
//   var(--color-*) 出现 204 次；
//   排版令牌在同一个文件里 var(--font-size-*) 出现 **0** 次 —— 它在编译期就被 Tailwind
//   写成了字面量（.text-heading-lg { font-size: 30px }）。
//   后果：改 tokens/tokens.json 的排版，已经编译好的产物不会跟。而现有两道门都看不见：
//     gen:check  只比「产物 vs SSOT」——两边都是新的，一致；
//     token-lock 只比「SSOT 有没有被改」——没改；
//   真正过期的东西在下游，没有任何检查覆盖。实测样本：一份 out.css 停在旧阶梯上
//   （.text-heading-lg 32px/1.2/-0.03em，当前为 30px/1.35/-0.01em），颜色却完全正确。
//
// 三条规则：
//   TY1 发布 CSS（packages/ 下手工维护的样式）里的排版字面量必须落在令牌阶梯上
//   TY2 消费方编译产物里落在阶梯之外的字号（信息级，按站点汇总）
//   TY3 消费方编译产物里，与阶梯同名的工具类取值必须与当前阶梯一致（=过期构建产物）
//
// 已知盲区（不假装覆盖）：
//   页面本地规则压过令牌工具类（例如 .hero-copy h1 特指度 0,1,1 压掉 .text-display-xl
//   的 0,1,0）需要「元素上同时命中了哪些选择器」的运行时信息，静态扫 CSS 判不出来，
//   本脚本不做这件事，也不给假阳性。

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { ROOT, loadTokens, stripMeta } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const KNOWN = join(ROOT, 'verification', 'known-issues.json');
const TODAY = new Date().toISOString().slice(0, 10);

const problems = [];
const warns = [];
const knownHits = [];
const info = [];

// ── 阶梯：从 SSOT 的 core.font-size 推导 ─────────────────────────────────
// 结构化组的四个子键就是生成器契约：size / lineHeight / fontWeight / letterSpacing
const T = loadTokens();
const STEPS = stripMeta(T.core)['font-size'] || {};
const px = (v) => { const m = /^(-?[\d.]+)px$/i.exec(String(v).trim()); return m ? parseFloat(m[1]) : null; };
const rem = (v) => { const m = /^(-?[\d.]+)rem$/i.exec(String(v).trim()); return m ? parseFloat(m[1]) * 16 : null; };
const em = (v) => { const m = /^(-?[\d.]+)em$/i.exec(String(v).trim()); return m ? parseFloat(m[1]) : null; };

const LADDER_SIZE = new Set();   // 绝对字号（px）
const LADDER_LH_PX = new Set();  // 绝对行高（px）
const LADDER_LH_NUM = new Set(); // 无单位行高（比例）
const LADDER_LS = new Set();     // 字距（em）
for (const [name, step] of Object.entries(STEPS)) {
  if (!step || typeof step !== 'object') continue;
  const s = px(step.size);
  if (s !== null) LADDER_SIZE.add(s);
  const lh = String(step.lineHeight ?? '');
  const a = px(lh); if (a !== null) LADDER_LH_PX.add(a);
  if (/^-?[\d.]+$/.test(lh)) LADDER_LH_NUM.add(parseFloat(lh));
  const ls = em(step.letterSpacing ?? '');
  if (ls !== null) LADDER_LS.add(ls);
  if (String(step.letterSpacing ?? '').trim() === '0') LADDER_LS.add(0);
}
// 无单位 0 也是合法字距
LADDER_LS.add(0);

const RESET = new Set(['inherit', 'normal', 'initial', 'unset', 'auto', '100%', '80%', '75%', '50%', '1em', '0', '0px']);

function classifyValue(prop, raw) {
  const v = String(raw).trim();
  if (/var\(/.test(v)) return { kind: 'token' };
  if (RESET.has(v.toLowerCase())) return { kind: 'reset' };
  const rel = /(%|em)$/i.test(v) && !/^[\d.]+(rem)$/i.test(v);
  if (prop === 'font-size') {
    const a = px(v); if (a !== null) return LADDER_SIZE.has(a) ? { kind: 'copy', num: a } : { kind: 'off', num: a };
    const r = rem(v); if (r !== null) return LADDER_SIZE.has(r) ? { kind: 'copy', num: r } : { kind: 'off', num: r };
    return rel ? { kind: 'relative' } : { kind: 'off', num: NaN };
  }
  if (prop === 'line-height') {
    const a = px(v); if (a !== null) return LADDER_LH_PX.has(a) ? { kind: 'copy', num: a } : { kind: 'off', num: a };
    const r = rem(v); if (r !== null) return LADDER_LH_PX.has(r) ? { kind: 'copy', num: r } : { kind: 'off', num: r };
    if (/^-?[\d.]+$/.test(v)) { const n = parseFloat(v); return LADDER_LH_NUM.has(n) ? { kind: 'copy', num: n } : { kind: 'off', num: n }; }
    return rel ? { kind: 'relative' } : { kind: 'off', num: NaN };
  }
  // letter-spacing
  const e = em(v); if (e !== null) return LADDER_LS.has(e) ? { kind: 'copy', num: e } : { kind: 'off', num: e };
  if (/^-?[\d.]+$/.test(v)) { const n = parseFloat(v); return LADDER_LS.has(n) ? { kind: 'copy', num: n } : { kind: 'off', num: n }; }
  return rel ? { kind: 'relative' } : { kind: 'off', num: NaN };
}

// ── TY1 发布 CSS 的排版字面量必须落在阶梯上 ──────────────────────────────
// 只扫「仓库内手工维护、会被发布出去」的样式。生成物（tokens.css / tailwind-preset/tokens.css）
// 由 gen:check 保证与 SSOT 一致，不在这里重复检查。
const PUBLISHED_CSS = ['packages/tokens/primitives.css'];
const TYPO_PROPS = ['font-size', 'line-height', 'letter-spacing'];
let ty1Scanned = 0;
for (const rel of PUBLISHED_CSS) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) { warns.push('TY1 ' + rel + ' 不存在，跳过'); continue; }
  const css = readFileSync(abs, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  let token = 0; let copy = 0; let off = 0; let relative = 0;
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) continue;
    for (const d of m[2].matchAll(/(font-size|line-height|letter-spacing)\s*:\s*([^;]+)/g)) {
      const prop = d[1]; const value = d[2].trim();
      ty1Scanned++;
      const c = classifyValue(prop, value);
      if (c.kind === 'token') { token++; continue; }
      if (c.kind === 'reset') continue;
      if (c.kind === 'copy') { copy++; continue; }
      if (c.kind === 'relative') {
        relative++;
        warns.push('TY1 ' + rel + ' ' + selector + '  ' + prop + ': ' + value + '（相对值，逃出阶梯但属正当手法）');
        continue;
      }
      off++;
      problems.push('TY1 ' + rel + ' ' + selector + '  ' + prop + ': ' + value +
        ' —— 绝对值不在令牌阶梯上（字号 ' + [...LADDER_SIZE].sort((a, b) => a - b).join('/') +
        '；无单位行高 ' + [...LADDER_LH_NUM].sort((a, b) => a - b).join('/') +
        '；字距 ' + [...LADDER_LS].sort((a, b) => a - b).join('/') + '）');
    }
  }
  const total = token + copy + off + relative;
  info.push('TY1 ' + rel + '：排版声明 ' + total + ' 条 —— 引用令牌 ' + token + ' / 抄令牌值 ' + copy +
    ' / 阶梯外 ' + off + ' / 相对值 ' + relative);
  if (total > 0 && token / total < 0.5) {
    warns.push('TY1 ' + rel + '：只有 ' + token + '/' + total + ' 条排版声明引用令牌，其余是写死的值——' +
      '改令牌不会传导到这份 CSS（颜色层已做到 var(--color-*)，排版层没有）');
  }
}

// ── TY2 / TY3 消费方编译产物 ─────────────────────────────────────────────
// sites/ 是可选的跨仓库对象：CI 只 checkout ui/ 时不存在，自动跳过。
// AUTIONAL_SITES_DIR 用于测试注入（把一份带过期字号的产物指给本脚本看它是否报警）。
const sitesDir = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
function collectCss(dir, acc) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) collectCss(p, acc);
    else if (e.name.endsWith('.css')) acc.push(p);
  }
  return acc;
}
const consumer = { scanned: 0, files: 0, outOfLadder: 0, sizes: 0, stale: 0 };
if (existsSync(sitesDir)) {
  for (const site of readdirSync(sitesDir)) {
    const sitePath = join(sitesDir, site);
    if (!statSync(sitePath).isDirectory()) continue;
    const css = collectCss(sitePath, []).filter((f) => /[\\/]dist[\\/]/.test(f));
    if (!css.length) continue;
    consumer.scanned++;
    consumer.files += css.length;
    let siteSizes = 0; let siteOff = 0; const samples = [];
    for (const file of css) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/([^{}]{1,200})\{([^}]*)\}/g)) {
        const selector = m[1].trim().replace(/\s+/g, ' ');
        const body = m[2];
        const fsMatch = /(?:^|;)\s*font-size\s*:\s*([^;]+)/.exec(body);
        if (!fsMatch) continue;
        const value = fsMatch[1].trim();
        // 只统计「字号字面量」：跳过重置与继承
        if (RESET.has(value.toLowerCase())) continue;
        const c = classifyValue('font-size', value);
        siteSizes++; consumer.sizes++;
        if (c.kind === 'off' || c.kind === 'relative') {
          siteOff++; consumer.outOfLadder++;
          if (samples.length < 6) samples.push(selector.slice(0, 44) + '=' + value);
        }
        // ── TY3：同名工具类 vs 当前阶梯 ──
        const cls = /^\.text-([a-z0-9-]+)$/.exec(selector);
        if (cls && STEPS[cls[1]]) {
          const step = STEPS[cls[1]];
          const want = px(step.size) !== null ? px(step.size) : rem(step.size);
          const got = px(value) !== null ? px(value) : rem(value);
          if (want !== null && got !== null && want !== got) {
            consumer.stale++;
            problems.push('TY3 ' + relative(ROOT, file).replace(/\\/g, '/') + '  .text-' + cls[1] +
              ' { font-size: ' + value + ' } 与当前阶梯不符（阶梯为 ' + step.size + '）—— 该文件是用旧阶梯编译的，需重新构建');
          }
        }
      }
    }
    if (siteOff > 0) {
      warns.push('TY2 ' + site + '：编译产物 ' + css.length + ' 个，字号字面量 ' + siteSizes +
        ' 处，其中 ' + siteOff + ' 处不在令牌阶梯上（' + samples.join(' ') + '）');
    } else {
      info.push('TY2 ' + site + '：编译产物 ' + css.length + ' 个，字号字面量 ' + siteSizes + ' 处，全部落在阶梯上');
    }
  }
} else {
  warns.push('TY2 本次工作区没有 sites/，跳过消费方编译产物核对（CI 里同样会跳过）');
}

// ── 已知问题登记（与 lint-tokens 同一套约定）─────────────────────────────
const known = existsSync(KNOWN) ? (JSON.parse(readFileSync(KNOWN, 'utf8')).issues || []) : [];
const knownFor = (msg) => known.find((k) => /^TY\d/.test(k.code) && (msg.indexOf(k.match) >= 0));
const suppressed = [];
const active = [];
for (const msg of problems) {
  const k = knownFor(msg);
  if (k) suppressed.push({ msg, issue: k });
  else active.push(msg);
}
// 登记自身的健康度：字段完整 + 到期。每条 issue 只报一次——
// 逐条 finding 地报会让同一条过期登记重复刷屏（5 条 finding → 5 条同样的错误）。
const expired = [];
for (const k of known) {
  if (!/^TY\d/.test(k.code)) continue;
  for (const field of ['id', 'code', 'match', 'reason', 'owner', 'expires']) {
    if (!k[field]) active.push('TY9 known-issue:' + (k.id || '?') + ' 缺少字段 ' + field);
  }
  if (k.expires && k.expires < TODAY) expired.push('TY9 登记 ' + k.id + ' 已过期（' + k.expires + '）：要么修掉，要么重新评估并续期');
}
for (const e of expired) active.push(e);

if (AS_JSON) {
  console.log(JSON.stringify({ errors: active.length, warnings: warns.length, suppressed: suppressed.length, staleArtifacts: consumer.stale, active, warns, suppressed, info }, null, 2));
} else {
  console.log('排版落地检查：阶梯 ' + Object.keys(STEPS).length + ' 档（字号 ' + [...LADDER_SIZE].sort((a, b) => a - b).join('/') + '）');
  console.log('  TY1 发布 CSS：检查 ' + ty1Scanned + ' 条排版声明');
  if (consumer.scanned) {
    console.log('  TY2/TY3 消费方：' + consumer.scanned + ' 个站点 / ' + consumer.files + ' 个编译产物 / ' +
      consumer.sizes + ' 处字号字面量，阶梯外 ' + consumer.outOfLadder + ' 处');
  }
  console.log('');
  for (const i of info) console.log('  [INFO ] ' + i);
  for (const w of warns) console.log('  [WARN ] ' + w);
  for (const a of active) console.log('  [ERROR] ' + a);
  for (const s of suppressed) console.log('  [KNOWN] ' + s.msg.slice(0, 96) + '  已登记为 ' + s.issue.id + '（owner ' + s.issue.owner + '，到期 ' + s.issue.expires + '）');
  console.log('');
  console.log(active.length === 0
    ? '结论：排版落地检查通过（' + warns.length + ' 警告，' + suppressed.length + ' 条已登记）'
    : '结论：排版落地检查失败（' + active.length + ' 错误，' + suppressed.length + ' 条已登记，其中过期产物 ' + consumer.stale + ' 个）');
}
process.exit(active.length === 0 ? 0 : 1);
