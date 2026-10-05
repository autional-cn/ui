#!/usr/bin/env node
// 类名可达性闸门（verify 第 15 道）
//
// 规则来自 preset 的构造方式，不是经验猜测：
//   Tailwind 要生成 {utility}-{name}，需要 colors[name] 存在。
//   设计系统的 primary / sky / amber / neutral / chart / method 在 preset 里是**色阶对象**
//   （{50:…, 900:…}），没有 DEFAULT 键。
//   ⇒ 裸的 bg-primary / text-primary / border-primary 一个类都生成不出来。
//
// 为什么必须机器守：这类写法 pnpm build 成功、零警告，页面上什么都不发生。
// 实测（2026-09-29）user 站有 42 处（text-primary 16 / bg-primary 15 / border-primary 11），
// 构建产物 CSS 里这三条规则一条都不存在。
//
// 这道闸门没有假阳性：命中即错——裸的 {utility}-{palette} 在任何情况下都不可能有规则。
// 它读的是 SSOT 的实际构造而非写死的名单，所以将来谁给某个色阶补了 DEFAULT，会自动放行。
//
// 例外（U389，2026-10-05）：`text-primary/secondary/muted/disabled` 由预设插件按令牌名
// 生成为**真实规则**（semanticTextUtilities），K1 按 SSOT 派生豁免（见下方 SEMANTIC_TEXT）；
// `bg-primary` / `border-primary` 等其余裸色阶仍判死——没有 DEFAULT 的决定不变。
//
// 「不补 DEFAULT」是**刻意的决定**（2026-09-29 拍板，理由写在 DESIGN.md
// § Tailwind overrides →「Ramp families have no DEFAULT」）。关键的反直觉点：
//   --color-bg-primary 是**页面底色**（--color-neutral-50），不是品牌蓝；
//   品牌蓝是 primary-700（#003153，与源头 autional/ui 的 DESIGN.md primary 完全一致）。
// 补 DEFAULT 只可能命中其中一个语义，对另一个语义的作者就是**静默的错色**——
// 那比构建期报错更糟。所以这里宁可不补，靠本闸门把失败变响并教正确写法。
//
// 用法: node scripts/check-classnames.mjs [--json]

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { ROOT, loadTokens, stripMeta, resolvedIn, contrastRatio } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');

if (!existsSync(SITES)) { console.log('check-classnames：本次工作区没有 sites/，跳过'); process.exit(0); }

const color = stripMeta(loadTokens().core.color);
const PALLETES = Object.keys(color).filter((k) => color[k] && typeof color[k] === 'object'
  && !Array.isArray(color[k]) && !Object.keys(color[k]).includes('DEFAULT'));
const PREFIXES = ['bg','text','border','ring','fill','stroke','from','to','via','divide','outline','decoration','placeholder','caret','shadow','accent'];

// U389（2026-10-05）：语义文本色类组。令牌键 `text-primary/secondary/muted/disabled`
// 由预设插件按令牌名生成真实规则（generate.mjs semanticTextUtilities）⇒ 对 `text-<键>`
// 这一精确形态豁免 K1。豁免集从 SSOT 派生（与 `text-inverse` 排除一致：flat inverse
// 色已提供同 var 的 text-inverse 类）；`bg-primary` 等其它裸色阶不受影响，仍判死。
const SEMANTIC_TEXT = new Set(Object.keys(color).filter((k) => /^text-[a-z0-9-]+$/.test(k) && k !== 'text-inverse'));

// 名字都是 [a-z-]，不含正则元字符，直接拼接即可。
// 左边界必须有：没有它，text-primary 会匹配到 --color-text-primary 里面去，
// 而那是 text-[var(--color-text-primary)] 这种**正确**写法（实测栽过这个跟头）。
const NEG = '(?<![a-zA-Z0-9_-])';
const NEG2 = '(?![a-zA-Z0-9_-])';
const RE = new RegExp(NEG + '(?:' + PREFIXES.join('|') + ')-(?:' + PALLETES.join('|') + ')' + NEG2, 'g');

// 对比度工具：用的是 lib 里那一份，避免各脚本各写一套颜色数学。
function contrast(fg, bg) { const r = contrastRatio(fg, bg); return typeof r === 'number' ? r : null; }

// ── K2 用「填充色」当文字 ─────────────────────────────────────────────────
// U66 第⑨项：「sky-500 在浅底 ≈1.68:1，连大字号 3:1 都不够，而参考站 index.astro:69 正在用」。
// 它当时的要求是「对比度债务**未登记**」——本闸门把它变成机器看得见的。
//
// 规则是**推导出来的**，不是手写名单：对每个色阶档位算它与浅色页面底的对比度，
// 低于 3:1 的档位就是「填充/装饰专用，不能当文字」。这样色阶一改，规则自动跟着改。
// 3:1 是 WCAG 对**大字号文本**（18pt+/14pt 粗体）的下限；正文要求 4.5。
// 这里用 3:1 作为「连大字号都不够」的红线，命中即说明真切不够。
const RES = resolvedIn(loadTokens(), {});
const BG = RES['color.bg-primary'] || '#fafbfc';
// 两条限定，都是第一版误报教出来的（第一版报了 200+ 处，几乎全是假阳性）：
//
// ① **排除 neutral**。中性色在浅底上当弱化文字是常态，而且设计系统自己就定义了
//    text-muted / text-disabled 这类刻意低对比的角色。把它们一律判死是噪声。
//    本条规则要抓的是「**品牌色阶**被当文字用」——那是把填充色误用成了前景色。
// ② **排除 dark: 变体**，并且整站豁免暗色优先的站点。规则比的是「对浅色页面底」的
//    对比度，而 authenticator 是纯黑底应用，它的 text-neutral-0（白字）在自家底上
//    完全正确。第一版正是栽在这里：同一类错误我上一轮已经犯过一次
//    （颜色闸门拿暗色反相的中性色当比对目标），这次是第二次——**规则必须知道自己
//    假设的是什么背景**。
const DARK_FIRST = ['authenticator'];
const FILL_ONLY = new Map();   // 'sky-500' -> 对比度
for (const pal of PALLETES) {
  if (pal === 'neutral') continue;
  for (const step of Object.keys(color[pal])) {
    if (step.startsWith('$')) continue;
    const v = RES['color.' + pal + '.' + step];
    if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) continue;
    const c = contrast(v, BG);
    if (c !== null && c < 3) FILL_ONLY.set(pal + '-' + step, c);
  }
}
const FG_PREFIXES = ['text', 'fill', 'stroke', 'decoration', 'caret'];
// (?<!dark:) —— dark: 变体下的前景色对的是深色底，不能拿浅底比。
const FILL_RE = new RegExp('(?<!dark:)' + NEG + '(?:' + FG_PREFIXES.join('|') + ')-(' + [...FILL_ONLY.keys()].join('|') + ')' + NEG2, 'g');

const SKIPDIR = new Set(['node_modules','.git','dist','.astro','.next','public','build','coverage','generated']);
// 测试面不在管辖内（U394，2026-10-05）：能力回归锁**刻意**以死类字面量作负例探针
// （如 trust theme-class-guard 的 'bg-primary/10' 编译探针），且测试产物不上线。
// 不排除会产生已知假阳性——本闸门「命中即错」的前提是对**上线内容**而言的。
function isTestFile(name) { return /\.(test|spec)\.[jt]sx?$/.test(name); }
// theme-class-guard 自己的 collectSourceFiles 同样跳过 __tests__/test——两处口径一致。
function walk(d, out) {
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of es) {
    if (SKIPDIR.has(e.name) || e.name === '__tests__' || e.name === 'test') continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (!isTestFile(e.name) && ['.tsx','.jsx','.ts','.astro','.html','.mdx'].includes(extname(e.name))) out.push(p);
  }
  return out;
}

const problems = [];
const advisory = [];   // 只报不判的观察（见 K2 的说明）
const perSite = [];
const groupBy = (arr, key) => {
  const m = new Map();
  for (const x of arr) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
};
for (const site of readdirSync(SITES)) {
  const dir = join(SITES, site);
  if (!statSync(dir).isDirectory()) continue;
  if (DARK_FIRST.includes(site)) continue;   // 暗色优先站点：规则的前提不成立，整站不参与 K2
  const hits = [];
  const fillHits = [];
  for (const f of walk(dir, [])) {
    const rel = f.replace(/\\/g, '/');
    if (/\/packages\//.test(rel)) continue;
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((ln, i) => {
      const code = ln.replace(/\/\/.*$/, '');
      const m = code.match(RE);
      if (m) for (const cls of new Set(m)) {
        if (SEMANTIC_TEXT.has(cls)) continue;   // U389 语义文本类：有真实插件规则
        hits.push({ cls, file: relative(SITES, f).replace(/\\/g, '/'), line: i + 1 });
      }
      const m2 = code.match(FILL_RE);
      if (m2) for (const cls of new Set(m2)) {
        const key = cls.replace(/^(text|fill|stroke|decoration|caret)-/, '');
        fillHits.push({ cls, key, ratio: FILL_ONLY.get(key), file: relative(SITES, f).replace(/\\/g, '/'), line: i + 1 });
      }
    });
  }
  // K2 只报不判：**静态分析无法知道元素的实际背景**。
  // 第一版把它当失败判据，报了 200+ 处，逐条看过去绝大多数是假阳性——
  // 例如 developer 的 text-sky-100 其实铺在深色代码面板上、
  // authenticator 整站是纯黑底（白字完全正确）。
  // 这类「对深色面板的浅色文字」静态上无法与真问题区分，所以只列出供人工过目，
  // 不阻断构建。把它做成硬闸门会变成噪声，而噪声会淹没 K1 那种真正零假阳性的信号。
  //
  // 真正可靠的做法是**在浏览器里按计算后的背景色判**——那是视觉回归闸门的地盘，
  // 不是这里的。本条保留的价值是：它能把候选集从整份代码缩到几十处。
  for (const [k, v] of groupBy(fillHits, (h) => h.cls)) {
    advisory.push('K2 ' + site + '：' + k + ' × ' + v.length + '（首处 ' + v[0].file + ':' + v[0].line +
      '）—— 该档位对浅色页面底只有 ' + v[0].ratio.toFixed(2) + ':1。若它确实铺在浅底上，应改用更深档位');
  }
  if (!hits.length && !fillHits.length) continue;
  const byCls = new Map();
  for (const h of hits) { if (!byCls.has(h.cls)) byCls.set(h.cls, []); byCls.get(h.cls).push(h); }
  perSite.push({ site, total: hits.length, classes: [...byCls.entries()].map(([c, v]) => ({ cls: c, n: v.length, first: v[0].file + ':' + v[0].line })) });
  for (const [cls, v] of byCls) {
    problems.push('K1 ' + site + '：' + cls + ' × ' + v.length + '（首处 ' + v[0].file + ':' + v[0].line +
      '）—— 色阶没有 DEFAULT 键（刻意如此，见 DESIGN.md「Ramp families have no DEFAULT」），这个类生成不出来。' +
      '品牌蓝写 <utility>-primary-700（#003153）；页面底色写 bg-[var(--color-bg-primary)]；' +
      '标题/正文色写 text-primary / text-secondary / text-muted / text-disabled（U389 语义类组）' +
      '或 text-[var(--color-text-primary)]——注意 --color-bg-primary 是页面底色，不是品牌蓝');
  }
}

if (AS_JSON) console.log(JSON.stringify({ palettes: PALLETES, perSite, problems }, null, 2));
else {
  console.log('类名可达性闸门：无 DEFAULT 的色阶 = ' + PALLETES.join(', '));
  if (advisory.length) {
    console.log('');
    console.log('  [注意] 以下 ' + advisory.length + ' 项是「浅色档位当文字」的候选，**仅供人工过目，不判失败**：');
    console.log('         静态分析不知道元素的实际背景；铺在深色面板上的浅色文字是正常的。');
    for (const a of advisory) console.log('    ' + a);
  }
  if (!perSite.length && !problems.length) console.log('\n结论：没有站点使用「生成不出来」的裸色阶类名');
  else {
    console.log('');
    for (const s of perSite) {
      console.log('  ' + s.site + '  共 ' + s.total + ' 处');
      for (const c of s.classes) console.log('      ' + c.cls.padEnd(20) + '× ' + String(c.n).padStart(3) + '   ' + c.first);
    }
    console.log('');
    for (const p of problems) console.log('  [ERROR] ' + p);
    console.log('结论：有 ' + problems.length + ' 种「写了但生成不出来」的类名');
  }
}
process.exit(problems.length ? 1 : 0);
