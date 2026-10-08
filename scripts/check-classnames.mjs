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
// K3（第 63 轮补·五）：名字根本不是名字 —— 「认识的颜色名后面挂了东西」。
// 来源是 trust 站的 `dark:to-surface00`：K1 的右边界 `(?![a-zA-Z0-9_-])` 要求「名字后面没字符」，
// 而它后面跟着一个 `0` ⇒ 边界不成立 ⇒ 既不报红、也生成不出规则（渐变暗色端静默失效）。
// 同族实测还有 auth/user 的 `text-muted-foreground`（shadcn 惯用名，DS 里没有）。
// 注意它与 K1 的分工：裸色阶（`bg-primary`）是 K1 的，K3 只管「合法的名字挂了尾巴」。
//
// 用法: node scripts/check-classnames.mjs [--json]
//       node scripts/check-classnames.mjs --selftest   （K3 的 15 条正负例控制，改规则前先跑它）

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, loadTokens, stripMeta, resolvedIn, contrastRatio } from './lib/tokens.mjs';
import { makeSkip } from './lib/scan-scope.mjs';

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

// ── K3 色阶名后面的非法续接字符 ───────────────────────────────────────────
// 来源是真事（第 63 轮补·五）：trust 站 compliance 页写着 `dark:to-surface00`。
// K1 的右边界 `(?![a-zA-Z0-9_-])` 让它**从缝里漏过去**——`to-surface` 后面跟着 `0`，
// 边界不成立，于是既不报 K1 也不报错，Tailwind 也认不出 `surface00`：
// 构建成功、零警告、渐变暗色端完全不生效。这与 K1 自己那句「静默的错色」是同一类，
// 只是形态不同：K1 抓「名字对但没 DEFAULT」，K3 抓「名字根本不是名字」。
//
// 规则同样是派生的，但名字来源必须**取全**：K1/K2 用的 PALLETES 只有「无 DEFAULT 的色阶对象」，
// 漏掉两类真实存在的颜色名 —— 扁平语义色（success / danger / surface / code …）与
// `{扁平色阶}-{档}`（success-soft / danger-text …）。第一版拿 PALLETES 拼规则，自检立刻抓到两个
// 假阴性：`dark:to-surface00`（surface 是扁平色）与 `ring-successSoft`（success 是扁平色）。
// 所以这里直接读 **preset 的 colors** —— 那才是「哪些名字真的能生成」的权威，与站点构建同源。
//
// 判定分两步，**不是**「色阶名 + 一个字符」的纯正则 —— 第一版那样写过，自检之外的全量跑立刻报了
// 三百多处假阳性：`text-neutral-500` 会先匹配到合法档位 `neutral-50`，再把尾巴的 `0` 当成「非法续接字符」。
// 数字档位天然互为前缀，所以必须按**整词**判，不能按前缀判。
//   ① 取出候选类名的 base（去掉变体前缀与 `/透明度`）；
//   ② base 在「能生成的合法名字集」里 ⇒ 放过；否则若 base 以某个已知颜色名**开头且更长**
//      ⇒ 那是「认识的名字后面挂了东西」，判 K3。裸色阶（`bg-primary`）不在此列，归 K1。
function presetTheme() {
  try {
    const preset = createRequire(import.meta.url)(resolve(ROOT, 'packages', 'tailwind-preset', 'index.js'));
    const t = preset?.theme?.extend || preset?.theme || {};
    return { colors: t.colors || {}, backgroundImage: t.backgroundImage || {}, boxShadow: t.boxShadow || {} };
  } catch (e) {
    console.log('check-classnames：读不到 preset 源（' + e.message + '），K3 退化为按令牌推导');
    const colors = {};
    for (const [k, v] of Object.entries(loadTokens().core.color)) {
      if (k.startsWith('$')) continue;
      if (v && typeof v === 'object') colors[k] = Object.fromEntries(Object.keys(v).filter((s) => !s.startsWith('$')).map((s) => [s, 1]));
      else colors[k] = v;
      if (/^(bg|text|border)-/.test(k)) colors[k.replace(/^[a-z]+-/, '')] = v;
    }
    return { colors, backgroundImage: {}, boxShadow: {} };
  }
}
const PRESET = presetTheme();
const PRESET_COLORS = PRESET.colors;
// 合法名字集：扁平色直接可用；色阶对象只有 `{族}-{档}` 可用（裸族名没有 DEFAULT ⇒ K1 判死，不在此列）。
const VALID_BASES = new Set();
const COLOR_FAMILIES = Object.keys(PRESET_COLORS);
for (const [k, v] of Object.entries(PRESET_COLORS)) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const s of Object.keys(v)) if (!s.startsWith('$')) VALID_BASES.add(k + '-' + s);
    if (Object.keys(v).includes('DEFAULT')) VALID_BASES.add(k);
  } else VALID_BASES.add(k);
}
// 合法集是**按工具前缀分的**：同一个 base 在不同工具下合法性不同 ——
// `bg-brand-radial` 合法（backgroundImage 里有 brand-radial），`text-brand-radial` 不合法。
// 全站合成一个集合会把这个区别抹掉（真事：第一版全量跑把 web 的 bg-brand-radial 误报成 K3）。
const VALID_BY_PREFIX = new Map();
for (const p of PREFIXES) {
  const set = new Set(VALID_BASES);
  if (p === 'bg') for (const k of Object.keys(PRESET.backgroundImage)) set.add(k);
  if (p === 'shadow') for (const k of Object.keys(PRESET.boxShadow)) set.add(k);
  VALID_BY_PREFIX.set(p, set);
}
// 候选类名：变体前缀可有，`[...]` 任意值不参与（它的内容不是颜色名）。
const K3_TOKEN_RE = new RegExp(NEG + '(?:[a-z-]+:)*(' + PREFIXES.join('|') + ')-([A-Za-z][A-Za-z0-9_-]*)', 'g');
function k3Scan(code) {
  const out = [];
  for (const m of code.matchAll(K3_TOKEN_RE)) {
    const valid = VALID_BY_PREFIX.get(m[1]);
    const base = m[2].split('/')[0];
    if (!valid || valid.has(base)) continue;
    if (!COLOR_FAMILIES.some((fam) => base.startsWith(fam) && base.length > fam.length)) continue;
    out.push(m[0]);
  }
  return out;
}

// 自检控制（--selftest）：规则是正则拼出来的，正负例各钉住，防止将来改 PREFIXES/PALLETES 时静默失效。
// 注意负例 `text-primary`（裸色阶）：那是 K1 的管辖，不是 K3 的——两条规则的分界必须钉住，
// 否则 K3 会把 K1 的整批命中重复报一遍。
if (process.argv.includes('--selftest')) {
  const probes = [
    // 正例：认识的名字后面挂了东西（真事 + 同族变形）
    ['dark:to-surface00', 1], ['bg-primary500', 1], ['text-chart100', 1], ['ring-successSoft', 1],
    ['text-dangerText', 1], ['bg-neutral500', 1],
    // 负例：合法形态一个都不能碰（档位互为前缀那次就是栽在这里）
    ['text-primary', 0], ['text-primary-700', 0], ['bg-[var(--color-bg-primary)]', 0], ['border-success-soft', 0],
    ['text-neutral-500 dark:text-neutral-400', 0], ['ring-primary-500 border-primary-500', 0],
    ['bg-success/10 text-danger-text', 0], ['from-chart-2 via-sky-500 to-surface', 0], ['text-[var(--color-text-muted)]', 0],
  ];
  let bad = 0;
  for (const [s, want] of probes) {
    const n = k3Scan(s).length;
    const ok = (want ? n > 0 : n === 0);
    if (!ok) bad++;
    console.log((ok ? '  ok   ' : '  FAIL ') + JSON.stringify(s) + ' want=' + want + ' got=' + n + (n ? ' [' + k3Scan(s).join(',') + ']' : ''));
  }
  console.log(bad ? 'K3 自检：' + bad + ' 条不符' : 'K3 自检：' + probes.length + '/' + probes.length + ' 通过');
  process.exit(bad ? 1 : 0);
}

const SKIPDIR = makeSkip('public');
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
  const k3Hits = [];
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
      for (const cls of new Set(k3Scan(code))) k3Hits.push({ cls, file: relative(SITES, f).replace(/\\/g, '/'), line: i + 1 });
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
  if (!hits.length && !fillHits.length && !k3Hits.length) continue;
  // 只为 K2 advisory 命中的站点不进 perSite —— 否则「有 0 种」这种自相矛盾的结论会出现
  // （perSite 非空但没有任何 K1/K3 命中）。
  if (!hits.length && !k3Hits.length) continue;
  const byCls = new Map();
  for (const h of hits) { if (!byCls.has(h.cls)) byCls.set(h.cls, []); byCls.get(h.cls).push(h); }
  const byK3 = new Map();
  for (const h of k3Hits) { if (!byK3.has(h.cls)) byK3.set(h.cls, []); byK3.get(h.cls).push(h); }
  perSite.push({ site, total: hits.length, k3Total: k3Hits.length, classes: [...byCls.entries()].map(([c, v]) => ({ cls: c, n: v.length, first: v[0].file + ':' + v[0].line })), k3: [...byK3.entries()].map(([c, v]) => ({ cls: c, n: v.length, first: v[0].file + ':' + v[0].line })) });
  for (const [cls, v] of byK3) {
    problems.push('K3 ' + site + '：' + cls + ' × ' + v.length + '（首处 ' + v[0].file + ':' + v[0].line +
      '）—— 色阶名后面接了非法续接字符，Tailwind 认不出这个名字，这个类生成不出来（多半是笔误，' +
      '如 to-surface00 应为 to-surface；合法形态只有 -{档位}、/透明度 或结束）');
  }
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
  if (!perSite.length && !problems.length) console.log('\n结论：没有站点使用「生成不出来」的类名（K1 裸色阶 / K3 非法续接字符）');
  else {
    console.log('');
    for (const s of perSite) {
      if (s.total) {
        console.log('  ' + s.site + '  共 ' + s.total + ' 处（K1 裸色阶）');
        for (const c of s.classes) console.log('      ' + c.cls.padEnd(20) + '× ' + String(c.n).padStart(3) + '   ' + c.first);
      }
      if (s.k3Total) {
        console.log('  ' + s.site + '  共 ' + s.k3Total + ' 处（K3 非法续接字符）');
        for (const c of s.k3) console.log('      ' + c.cls.padEnd(20) + '× ' + String(c.n).padStart(3) + '   ' + c.first);
      }
    }
    console.log('');
    for (const p of problems) console.log('  [ERROR] ' + p);
    console.log('结论：有 ' + problems.length + ' 种「写了但生成不出来」的类名');
  }
}
process.exit(problems.length ? 1 : 0);
