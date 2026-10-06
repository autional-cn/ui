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

// ── TY4 品牌语义字号的采用率 / TY5 共享组件层有没有消费方 ────────────────
// 实测（2026-09）：14 个站点里，品牌命名的字号工具类
// （text-display-* / heading-* / body-* / label-* / code-*）出现 **0 次**，
// 而 Tailwind 默认档（text-xs … text-5xl）出现 **3019 次**。
// 品牌排版阶梯存在、被锁、被 lint、被 gen:check 守护，但在舰队里的采用率是 0。
// 这比任何一个具体的字号值都更能解释「还原度低」——问题不在定义，在没有消费方。
// 同一批站点里也没有任何一个 import primitives.css（共享组件层），
// 而是各自在 global.css 里手写一份 .brand-shell / .brand-button-primary / .brand-kicker。
const BRAND_STEP_NAMES = Object.keys(STEPS).filter((k) => !/^(xs|sm|base|lg|xl|2xl|3xl|4xl)$/.test(k));
const NEUTRAL_STEP_NAMES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];
const SRC_EXT = /\.(astro|tsx|ts|jsx|js|mjs|vue|svelte|css|md|mdx|html)$/;
const SRC_SKIP = /[\\/](node_modules|dist|\.git|\.astro|\.next)[\\/]/;
function collectSrc(dir, acc) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) collectSrc(p, acc);
    else if (SRC_EXT.test(e.name)) acc.push(p);
  }
  return acc;
}
// 边界用 [^a-z0-9-] 而不是引号集合：class 出现在 " " / ' ' / 反引号 / : 之后都能命中，
// 且不必在正则里写引号字符。
const countClass = (text, name) =>
  (text.match(new RegExp('(?:^|[^a-z0-9-])text-' + name + '(?![a-z0-9-])', 'g')) || []).length;
if (existsSync(sitesDir)) {
  let brandHits = 0;
  let neutralHits = 0;
  const importers = [];
  let siteCount = 0;
  for (const site of readdirSync(sitesDir)) {
    const sitePath = join(sitesDir, site);
    if (!statSync(sitePath).isDirectory()) continue;
    const files = collectSrc(sitePath, []).filter((f) => !SRC_SKIP.test(f));
    if (!files.length) continue;
    siteCount++;
    let sb = 0; let sn = 0; let imports = false;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      // 「消费」= 真的把它加载进来：@import '…/primitives.css' 或
      // <link href="https://cdn.autional.cn/ui/v<ver>/primitives.css">（轮次 42 起站点走 CDN）。
      // 早期版本只匹配裸文件名 primitives.css，于是**注释里提到它**也会被算成消费
      // （实测站点里有这样的说明性注释），那是假阳性——判据必须盯「加载」而不是「提到」。
      if (/@import\s+['"][^'"]*primitives\.css/.test(text) ||
          /<link\b[^>]*\bhref=["'][^"']*primitives\.css["']/.test(text)) imports = true;
      for (const n of BRAND_STEP_NAMES) sb += countClass(text, n);
      for (const n of NEUTRAL_STEP_NAMES) sn += countClass(text, n);
    }
    if (imports) importers.push(site);
    brandHits += sb; neutralHits += sn;
  }
  const totalHits = brandHits + neutralHits;
  // 注意：这里**刻意只作 info，不判失败**。本规则的早期版本把「语义名占比 0」当成错误，
  // 那个判据是错的：preset 的 fontSize 里 xs…4xl 本身就是定义在 core.font-size 的**品牌令牌**，
  // 语义名（body-md / heading-lg / …）只是额外的角色别名，且两者取值大量重合。
  // 站点写 text-base 并不等于它不受品牌管辖。真正的判据见下方 TY4b（编译产物指纹）。
  info.push('TY4a 语义角色名的采用情况（信息级，不判失败）：品牌语义档 ' + brandHits + ' 处 / 通用档 ' + neutralHits + ' 处');
  info.push('TY5 共享组件层 primitives.css 的消费方：' + importers.length + '/' + siteCount +
    ' 个站点（@import 或 CDN <link> 均计入）' + (importers.length ? '：' + importers.join(', ') : ''));
  if (siteCount > 0 && importers.length === 0) {
    problems.push('TY5 packages/tokens/primitives.css 被 DESIGN.md 与 ASTRYX_MANIFEST.json 声明为共享组件层' +
      '（brand-shell / brand-card / brand-button-* / brand-kicker / docs-prose / developer-*），但 ' + siteCount +
      ' 个站点里 0 个真正加载它（@import 或 CDN <link>）；这些类在各站点 global.css 里被逐份手写重实现。' +
      '声明为「复用它，别再造一个按钮」的契约，实际消费方为零。');
  }
}

// ── TY6 共享组件库的样式表是否真的进了产物 ──────────────────────────────
// 实测（2026-09 轮次 43）：packages/ui/package.json 里写的是
// `"sideEffects": ["**/*.css"]`，而在 Windows 上 Rollup 的 sideEffects 过滤器**匹配不上**
// （路径是反斜杠，picomatch 的 `**/*.css` 不命中）—— 于是 `import './styles/globals.css'`
// 被摇掉：**共享组件层的样式表从未进过任何一个站点的产物**。
// 9 个站点各自在 app 级 CSS 里手写了一份一模一样的 html/body base 块来补偿，
// 这正是「看起来是共享的、其实是 9 份拷贝」的来源。改成 `sideEffects: true` 后产物里才有了它。
//
// 「声明了但从没交付」与 KI-007（字体只声明不交付）是同一类问题：两边看起来都对，
// 而浏览器什么都没拿到。所以这一条只问一件事：**产物里到底有没有它**。
// 指纹用共享层独有的那条规则（html { font-family: var(--font-sans) }）——站点的 app 级 CSS
// 已不再重复它，CDN 的 tokens.css 也不进 bundle，所以它只可能来自共享层。
const SHARED_CSS_MARK = /font-family:\s*var\(--font-sans\)/;
const SHARED_UI_IMPORT = /from\s+['"]@autional\/ui['"]|require\(\s*['"]@autional\/ui['"]\s*\)/;
if (existsSync(sitesDir)) {
  const rows = [];
  for (const site of readdirSync(sitesDir)) {
    const sp = join(sitesDir, site);
    if (!statSync(sp).isDirectory()) continue;
    // 2026-09 起组件库走 npm，判据不再依赖「站点里有 packages/ui」——那个目录已经全部删除。
    // 改为直接问：这个站点的源码真的 import 了 @autional/ui 吗？import 了而产物里没有它，
    // 才是要抓的病（声明了但不交付）。
    const src = collectSrc(sp, []).filter((f) => !SRC_SKIP.test(f));
    const uses = src.some((f) => SHARED_UI_IMPORT.test(readFileSync(f, 'utf8')));
    if (!uses) { info.push('TY6 ' + site + '：声明了 @autional/ui 但源码里没有任何 import —— 未参与（基底层由 CDN 的 tokens.css 提供）'); continue; }
    const css = collectCss(sp, []).filter((f) => /[\\/]dist[\\/]/.test(f));
    if (!css.length) { info.push('TY6 ' + site + '：没有构建产物，跳过'); continue; }
    const text = css.map((f) => readFileSync(f, 'utf8')).join('\n');
    rows.push({ site, ok: SHARED_CSS_MARK.test(text) });
  }
  const bad = rows.filter((r) => !r.ok);
  if (rows.length) info.push('TY6 共享组件库 packages/ui 的样式表进入产物的站点：' + (rows.length - bad.length) + '/' + rows.length);
  for (const b of bad) {
    problems.push('TY6 ' + b.site + '：构建产物里找不到共享组件库 packages/ui 的 base 层' +
      '（指纹 html { font-family: var(--font-sans) }）—— 它被声明了却没有交付。' +
      '先查 packages/ui/package.json 的 sideEffects：写成 ["**/*.css"] 时 Windows 上匹配不上，' +
      'Rollup 会把 import "./styles/globals.css" 摇掉（实测）。');
  }
}

// ── TY4b 站点是否真的被品牌排版管辖（编译产物指纹）──────────────────────
// 判据要能区分「站点的字号来自品牌 preset」与「来自 Tailwind 默认」。编译产物里可精确判别：
//   品牌 preset 的 text-3xl 是 30px/36px **且带 font-weight:700**（定义在 core.font-size.3xl）；
//   Tailwind 默认的 text-3xl 是 1.875rem/2.25rem 且**不设字重**。
// 另一条独立指纹：品牌 preset 的 rounded-lg 是 24px，Tailwind 默认是 8px。
// 命中任一即视为受品牌管辖；一条都不命中说明该站点的工具类来自 Tailwind 默认。
const presetFingerprints = [
  { name: 'text-3xl 带字重', re: /\.text-3xl\s*\{[^}]*font-weight:\s*700/ },
  { name: 'rounded-lg = 24px', re: /\.rounded-lg\s*\{\s*border-radius:\s*24px/ },
];
if (existsSync(sitesDir)) {
  const verdicts = [];
  for (const site of readdirSync(sitesDir)) {
    const sitePath = join(sitesDir, site);
    if (!statSync(sitePath).isDirectory()) continue;
    const css = collectCss(sitePath, []).filter((f) => /[\\/]dist[\\/]/.test(f));
    if (!css.length) continue;
    const text = css.map((f) => readFileSync(f, 'utf8')).join('\n');
    const hit = presetFingerprints.find((fp) => fp.re.test(text));
    verdicts.push({ site, hit: hit ? hit.name : null });
  }
  const governed = verdicts.filter((v) => v.hit);
  info.push('TY4b 受品牌 preset 管辖的站点：' + governed.length + '/' + verdicts.length +
    (governed.length ? '（指纹：' + governed[0].hit + '）' : ''));
  const notGoverned = verdicts.filter((v) => !v.hit);
  if (notGoverned.length) {
    problems.push('TY4b 有 ' + notGoverned.length + ' 个站点的编译产物里找不到任何品牌 preset 指纹（' +
      presetFingerprints.map((f) => f.name).join(' / ') + '）：' + notGoverned.map((v) => v.site).join(', ') +
      '。这些站点的字号/圆角等工具类来自 Tailwind 默认而非品牌 preset，即排版不受品牌管辖。' +
      '修法：在该站点的 tailwind.config 里加载 @autional/tailwind-preset（见 pnpm sync:consumers）。');
  }
}

// ── 已知问题登记（与 lint-tokens 同一套约定）─────────────────────────────
const known = existsSync(KNOWN) ? (JSON.parse(readFileSync(KNOWN, 'utf8')).issues || []) : [];
// 必须同时匹配 code 与 match：只要求 code 前缀会让「针对 TY1 的登记」把 TY5 的发现也吞掉，
// 而 known-issues.json 的 $rules 明确写了「match 粒度要够细，不能用来屏蔽整类检查」。
const codeOf = (msg) => { const m = /^(TY\d)/.exec(msg); return m ? m[1] : null; };
const knownFor = (msg) => { const c = codeOf(msg); return c ? known.find((k) => k.code === c && msg.indexOf(k.match) >= 0) : undefined; };
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
