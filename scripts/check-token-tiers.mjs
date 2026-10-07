#!/usr/bin/env node
// check-token-tiers —— 令牌档位闸门（verify 第 28 道）
// 用法: node scripts/check-token-tiers.mjs [--json] [--write-registry]
//
// 守的是什么：**圆角 / 阴影 / 间距只能落在设计系统的档位上。**
//
// 为什么需要它：preset 是 \`theme.extend\` 而不是整表覆盖，所以 Tailwind 的出厂值
// （\`rounded\` 4px、\`shadow-sm/md/lg\`、间距 7/9/11/14/24/28…）**是能生成出来的**。
// 于是这些类不会像裸色阶那样被 K1（写不出来的类）拦下 —— 第 55 轮实测：全舰队 817 处
// 写在档位之外，而 27 道闸门没有一道在守它。L5/C11 收色阶时踩的是同一个形态。
//
// 判据的两侧（缺一侧就不成立）：
//   · 站点侧：棘轮。每个站的计数只许减不许增，基线记在 verification/token-tiers.json。
//   · DS 侧：硬零。设计系统自己不许写档位外的类 —— 否则「照规范改」这句话自相矛盾：
//     站点被要求用 shadow-card，而 SectionCard 自己写着 shadow-sm（DESIGN.md :435 已登记这条债）。
//
// 判据的口径（不是黑白名单，是从 SSOT 派生的）：
//   合法集合**直接读 tokens/tokens.json**，不在这里硬编码 —— 改令牌，判据跟着动。
//   · radius：xs/sm/md/lg/xl/xxl/full；\`rounded-none\` 合法（0 不是档位，是「没有圆角」）；
//     裸 \`rounded\` 违规（Tailwind DEFAULT 4px，在档位里没有名字 —— 第 55 轮已补 xs 给它）。
//   · shadow：soft/card/brand/code/deep；\`shadow-none\` 合法。
//   · space：SSOT 的键（含第 55 轮补进 SSOT 的控件密度档 0.5/1.5/2.5/3.5 与节奏档 16/20）；
//     \`-0\` 合法（「无间距」不是档位问题）；任意值 \`-[…]\` 违规。
//
//   · spaceArb（任意值）：**但「令牌的算式」不算任意值**（第 62 轮补）。pb-[calc(var(--a)+var(--b))]
//     与 pt-[15vh] 不是同一件事：前者的每一个数都来自设计系统，改令牌它就跟着变；后者的数是写死的。
//     口径：calc/min/max/clamp 且**只由设计系统真正发出来的 CSS 变量**（扫 packages/tokens 的生成物得到）
//     与运算符/括号/无单位数字组成 → 合法；混进任何字面量（+12px）、引用未发出的变量、
//     或干脆只是一个裸变量（pb-[var(--space-12)] —— 它本来就有档位类 pb-12）→ 照旧违规。
//// 度量器自检（学 C5/C9/C10/C11 的做法，双向都要有）：
//   正例 —— 一段必然违规的样本必须被数出来；数不出来说明解析器失灵，棘轮会**全绿**。
//   反例 —— 注释里的类名、\`rounded-none\`、\`-0\`、测试文件里的断言串都不许命中。
//   第 55 轮实测的教训：SectionCard.tsx 顶上的注释就写着 \`rounded-2xl\`（解释为什么不用它），
//   只剥块注释的扫描器会把它当成违规 —— 注释必须**两种都剥**（\`/* */\` 与 \`//\`）。

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { ROOT, TOKENS_PATH, loadTokens } from './lib/tokens.mjs';
import { makeSkip, classSpans, inClassSpan } from './lib/scan-scope.mjs';

const AS_JSON = process.argv.includes('--json');
const WRITE = process.argv.includes('--write-registry');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const REGISTRY = join(ROOT, 'verification', 'token-tiers.json');

// ── 扫描范围：与 check-colors.mjs 同一套 SKIPDIR / SKIPREL（判据之间口径要一致）──
// 范围：共享定义（第 56 轮起）+ 生成物树；与 check-colors 同口径
const SKIPDIR = makeSkip('public', 'wiki-src');
const SKIPREL = [/(^|\/)packages\/tailwind-preset\//, /(^|\/)packages\/tokens\//, /(^|\/)packages\/ui\/dist\//, /(^|\/)scripts\/generate\.mjs$/];
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.astro', '.mjs', '.vue', '.svelte']);
// 测试与 story：里面的类名是**断言字符串**，不是渲染出来的类（不做这个排除，SectionCard
// 那条「不许写回 rounded-2xl」的证否式用例会被本闸门反过来判成违规）。
const TESTRE = /(\.|\/)(test|spec)\.[tj]sx?$|__tests__|__mocks__|\.stories\.[tj]sx?$/;

function walk(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (SKIPDIR.has(e.name)) continue;
    if (e.isDirectory()) { walk(p, out); continue; }
    if (!EXTS.has(extname(e.name))) continue;
    if (TESTRE.test(p)) continue;
    out.push(p);
  }
  return out;
}

/** 剥注释：块注释与行注释都要剥（第 55 轮的实测教训见文件头）。 */
// ⚠️ 长度与换行都要保持：否则报出来的行号是「剥完注释之后的坐标」，与被指的文件对不上
// （第 55 轮实测：AuditStatsOnly.tsx 的真实行是 32，报出来是 17）。
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

// ── 合法档位：从 SSOT 派生 ────────────────────────────────────────────────
const T = loadTokens();
const keys = (node) => Object.keys(node || {}).filter((k) => !k.startsWith('$'));
const RADIUS = new Set(keys(T.core.radius));
const SHADOW = new Set(keys(T.core.shadow));
const SPACE = new Set(keys(T.core.space));
// 动效：duration 的合法值 = 令牌里的毫秒数值（preset 就是按毫秒值生成 duration-<n> 的）
const DURATION = new Set(keys(T.core.motion)
  .filter((k) => k.startsWith('duration-'))
  .map((k) => String(T.core.motion[k]).replace('ms', '')));
const EASE = new Set(keys(T.core.motion).filter((k) => k.startsWith('ease-')).map((k) => k.slice('ease-'.length)));
// 图标描边：SSOT 里的 icon.stroke
const STROKE = String(T.core.icon.stroke);
// 数据可视化（进度环 / 评分环 / 图表）**不是图标** —— 它们自己的描边是图形参数，不是图标纪律。
// 判据用**文件名**声明这条边界（Ring / Score / Chart / Gauge），与「配置即声明」的既有做法一致。
const VIZ_FILE = /(Ring|Score|Chart|Gauge|Sparkline|Donut)\.(tsx|ts|jsx|js|astro)$/i;
const DIRS = new Set(['t', 'b', 'l', 'r', 's', 'e', 'tl', 'tr', 'bl', 'br', 'ss', 'se', 'es', 'ee']);
const SPACE_PREFIX = 'p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|bottom|left|right|start|end';
const SENTINEL = '<div class="rounded-zz9-probe dsh-token-tier-probe-zz9" />';

// ── 「令牌的算式」的合法变量集合：扫设计系统**真正发出来的** CSS 变量 ──────
// 不在这里手抄一份名单：抄一份的结果是「加了令牌而判据不认识」。
const EMITTED_VARS = new Set();
for (const dir of [join(ROOT, 'packages', 'tokens'), join(ROOT, 'packages', 'tailwind-preset')]) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (extname(e.name) !== '.css') continue;
      for (const m of readFileSync(p, 'utf8').matchAll(/(--[a-z0-9-]+)\s*:/g)) EMITTED_VARS.add(m[1]);
    }
  }
}

/** 一个 -[…] 任意值是不是「只由设计系统令牌算出来的」。见文件头口径：
 *  这是**合法**的任意值（随令牌而动），不是档位违规。 */
export function isTokenCalc(v) {
  if (!v.startsWith('[') || !v.endsWith(']')) return false;
  const inner = v.slice(1, -1).trim();
  if (!/^(calc|min|max|clamp)\(/.test(inner)) return false;
  const refs = [...inner.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
  if (!refs.length) return false;
  if (refs.some((n) => !EMITTED_VARS.has(n))) return false;
  const rest = inner.replace(/var\(--[a-z0-9-]+\)/g, '').replace(/\b(calc|min|max|clamp)\b/g, '');
  return /^[\s\d+\-*/().,%]*$/.test(rest);
}

/** 一段文本里所有「档位外的类」。返回 [{cls, cat, index}] */
export function scanText(text) {
  const s = stripComments(String(text));
  // **判据只落在会渲染的类上**：散文、注释、断言字符串、乃至密码黑名单（auth 的
  // local-blacklist.ts 里真的有一行 'shadow'）都不是类。第 57 轮实测：不过是这一条，
  // space 的 36 处违规里有 4 处是假阳性 —— 而假阳性会让棘轮永远收不到 0，于是台账变成噪声。
  const spans = classSpans(s);
  const push = (cls, cat, index) => { if (inClassSpan(spans, index, cls.length)) out.push({ cls, cat, index }); };
  const out = [];
  // 圆角
  for (const m of s.matchAll(/(?<![\w-])rounded(?:-[a-z0-9]+)*(?:-\[[^\]]+\])?/g)) {
    const cls = m[0];
    let parts = cls.split('-').slice(1);
    if (parts.length > 1 && DIRS.has(parts[0])) parts = parts.slice(1);
    const bare = parts.length === 0;
    const logical = parts.length === 1 && parts[0] === 'none';
    const tier = parts.length === 1 && RADIUS.has(parts[0]);
    if (bare || (!tier && !logical)) push(cls, 'radius', m.index);
  }
  // 阴影（负向前瞻排除 drop-shadow / text-shadow 一类）
  for (const m of s.matchAll(/(?<![\w-])shadow(?:-[a-z0-9]+)*(?:-\[[^\]]+\])?/g)) {
    const cls = m[0];
    const parts = cls.split('-').slice(1);
    const bare = parts.length === 0;
    const none = parts.length === 1 && parts[0] === 'none';
    const tier = parts.length === 1 && SHADOW.has(parts[0]);
    if (tier || none) continue;
    if (!bare && !['sm', 'md', 'lg', 'xl', '2xl', 'inner'].includes(parts[0])) continue; // 非阴影色阶族，交给别的闸门
    push(cls, 'shadow', m.index);
  }
  // 间距
  const re = new RegExp('(?<![\\w-])(?:' + SPACE_PREFIX + ')-(\\d+(?:\\.\\d+)?|\\[[^\\]]+\\])(?![\\w-])', 'g');
  for (const m of s.matchAll(re)) {
    const v = m[1];
    if (v === '0') continue;                       // 「无间距」不是档位问题
    if (SPACE.has(v)) continue;                    // SSOT 的键即合法（含密度档与节奏档）
    // 任意值与档位值**是两个问题**：pt-[15vh] / my-[100px] 是视口与布局定位，不是间距档位。
    // 单列一类（报出来、棘轮钉住），而不是假装它们是档位违规。
    if (v.startsWith('[')) {
      if (isTokenCalc(v)) continue;                // 令牌的算式 = 随令牌而动，不是裸任意值
      push(m[0], 'spaceArb', m.index);
      continue;
    }
    push(m[0], 'space', m.index);
  }
  // 动效：duration-<毫秒> 与 ease-<名字>（第 56 轮接进 preset 后，二者都由令牌派生）
  for (const m of s.matchAll(/(?<![\w-])duration-(\d+|\[[^\]]+\])/g)) {
    if (DURATION.has(m[1])) continue;
    push(m[0], 'motion', m.index);
  }
  for (const m of s.matchAll(/(?<![\w-])ease-([a-z-]+)/g)) {
    if (EASE.has(m[1])) continue;
    push(m[0], 'motion', m.index);
  }
  return out;
}

/** 图标描边：判据是「**图标**只走一个档位」，所以要先把「不是图标的东西」认出来。
 *  排除三类（都从上下文判定，不靠白名单）：
 *    ① 手绘 SVG 图形（<svg>/<path>/<circle>/<rect>…）—— 转圈指示器、状态插画自带线宽；
 *    ② 数据可视化组件（Ring / Score / Chart / Gauge…）—— 环的粗细是**图形参数**；
 *    ③ 定义处（没有 JSX 标签上下文的 props 默认值）—— 由文件名那份 VIZ_FILE 规则兜。
 *  剩下的就是图标：lucide 组件、或站点的图标包装组件（如 <Icon />）。 */
const RAW_SVG = /^(svg|g|path|circle|rect|line|polyline|polygon|ellipse|defs|text|tspan|use|mask|clipPath|linearGradient|radialGradient|stop)$/;
const VIZ_NAME = /(Ring|Score|Chart|Gauge|Sparkline|Donut)/;
export function scanStroke(text, relPath) {
  if (VIZ_FILE.test(relPath || '')) return [];
  const s = stripComments(String(text));
  const out = [];
  // 取值形态有三种： strokeWidth="2" / strokeWidth={2} / strokeWidth={cond ? 2.5 : 2}
  // 第三种是「条件描边」（选中态变粗），早先的正则整个漏掉了它 —— 实测：authenticator 的底部导航
  // 写的就是 strokeWidth={isActive ? 2.5 : 2}，而闸门一声不吭。度量器漏报比误报更难发现。
  for (const m of s.matchAll(/strokeWidth\s*[=:]\s*(?:\{([^}]*)\}|["']?([0-9.]+))/g)) {
    const values = m[1] !== undefined ? (m[1].match(/[0-9]+(?:\.[0-9]+)?/g) || []) : [m[2]];
    const bad = values.filter((v) => v !== STROKE);
    if (!bad.length) continue;
    const before = s.slice(0, m.index);
    const tagMatch = before.match(/<([A-Za-z][\w.]*)[^<>]*$/);
    const tag = tagMatch ? tagMatch[1] : '';
    if (!tag) continue;                       // ③ 定义处 / 非 JSX 上下文
    if (RAW_SVG.test(tag)) continue;          // ① 手绘 SVG 图形
    if (VIZ_NAME.test(tag)) continue;         // ② 数据可视化组件
    out.push({ cls: 'strokeWidth=' + bad.join('/') + ' on <' + tag + '>', cat: 'stroke', index: m.index });
  }
  return out;
}

// ── 度量器自检（双向）────────────────────────────────────────────────────
const problems = [];
const warns = [];
const POS = '<div class="rounded-2xl shadow-md py-7 rounded duration-700 ease-spring" strokeWidth={2.5}>x</div>';
const NEG_BLOCK = '/* rounded-2xl shadow-md py-7 duration-700 */ <span class="rounded-none shadow-none p-0 gap-0">y</span>';
const NEG_LINE = '// rounded-3xl shadow-lg py-9 duration-999\n<div class="rounded-xs shadow-card p-1.5 gap-16 duration-200 ease-out ease-standard" strokeWidth={2}>z</div>';
// 反例之二：**不是类语境**的字符串（散文、密码黑名单、断言串）——第 57 轮实测的假阳性来源
const NEG_PROSE = '<p>我们用了 rounded corners 与 shadow 两件事</p>\nconst list = [\'shadow\', \'py-7\', \'rounded-2xl\']';
const NEG_VIZ = 'strokeWidth={3}';
// 第 62 轮：把「令牌的算式」从「裸任意值」里分开 —— 两侧都要有对照
const CALC_OK = '<div class="pb-[calc(var(--layout-bottom-nav-height)+var(--space-12))] top-[min(var(--space-4),var(--space-8))]" />';
const CALC_BAD = '<div class="pb-[15vh] pb-[calc(var(--space-12)+12px)] pb-[calc(var(--nope-zz9)+var(--space-12))] pb-[var(--space-12)]" />';
const calcOkHits = scanText(CALC_OK).length;
const calcBadHits = scanText(CALC_BAD).filter((h) => h.cat === 'spaceArb').length;
const posHits = scanText(POS);
const negHits = scanText(NEG_BLOCK).length + scanText(NEG_LINE).length + scanText(NEG_PROSE).length
  + scanStroke(NEG_LINE, 'probe/Thing.tsx').length            // strokeWidth={2} 合法
  + scanStroke(NEG_VIZ, 'components/CountdownRing.tsx').length; // 进度环不是图标
const posCats = { radius: 0, shadow: 0, space: 0, motion: 0, stroke: 0 };
for (const h of posHits) posCats[h.cat]++;
for (const h of scanStroke(POS, 'probe/Thing.tsx')) posCats[h.cat]++;
if (posCats.radius !== 2 || posCats.shadow !== 1 || posCats.space !== 1 || posCats.motion !== 2 || posCats.stroke !== 1) {
  problems.push('TT00 度量器正向控制失败：正例应数出 radius=2 / shadow=1 / space=1 / motion=2 / stroke=1，实际 ' + JSON.stringify(posCats) + ' —— 解析器失灵时棘轮会全绿，那比红危险');
}
if (calcOkHits !== 0) {
  problems.push('TT00 度量器失败：令牌算式被当成裸任意值数出来了（' + calcOkHits + ' 条）—— 那会让「用令牌拼出来的值」永远收不干净');
}
if (calcBadHits !== 4) {
  problems.push('TT00 度量器失败：裸任意值/混字面量/未知令牌/裸变量 应数出 4 条，实际 ' + calcBadHits + ' 条 —— 放宽判据时把门一起放开了');
}
if (negHits !== 0) {
  problems.push('TT00 度量器负向控制失败：反例（注释里的类名、rounded-none/shadow-none、-0、合法档位）数出了 ' + negHits + ' 条 —— 度量器在误报');
}
if (scanText(SENTINEL).length !== 1) {
  problems.push('TT00 度量器哨兵失败：不可能存在的类没有被数出来 —— 匹配器恒假');
}

// ── 站点侧扫描（棘轮）───────────────────────────────────────────────────
function scanSite(dir) {
  const acc = { radius: 0, shadow: 0, space: 0, spaceArb: 0, motion: 0, stroke: 0 };
  for (const f of walk(dir)) {
    const rel = relative(SITES, f).split('\\').join('/');
    if (SKIPREL.some((rx) => rx.test(rel))) continue;
    const text = readFileSync(f, 'utf8');
    for (const h of scanText(text)) acc[h.cat]++;
    for (const h of scanStroke(text, rel)) acc[h.cat]++;
  }
  return acc;
}
const sites = existsSync(SITES)
  ? readdirSync(SITES).filter((n) => { try { return statSync(join(SITES, n)).isDirectory(); } catch { return false; } })
  : [];
const siteCounts = {};
for (const s of sites) siteCounts[s] = scanSite(join(SITES, s));

// ── DS 侧扫描（硬零 + 过渡期白名单）──────────────────────────────────────
const dsHits = [];
for (const f of walk(join(ROOT, 'packages'))) {
  const rel = relative(ROOT, f).split('\\').join('/');
  if (SKIPREL.some((rx) => rx.test(rel))) continue;
  const text = readFileSync(f, 'utf8');
  const stripped = stripComments(text);
  for (const h of [...scanText(text), ...scanStroke(text, rel)]) {
    const before = stripped.slice(0, h.index);
    const line = before.split('\n').length;
    dsHits.push({ file: rel, line, cls: h.cls, cat: h.cat });
  }
}

// ── 台账比对 ────────────────────────────────────────────────────────────
/** 棘轮比对：给定「站点计数」与「台账」，返回 {problems, warns}。抽成函数是为了让它自己能被对照测试。 */
export function compareRatchet(counts, reg) {
  const p = [], w = [];
  for (const [site, acc] of Object.entries(counts)) {
    const base = reg && reg.sites && reg.sites[site];
    if (!base) { w.push('TT02 ' + site + ' 未登记在台账里（新站点？跑 --write-registry 补登）'); continue; }
    for (const cat of ['radius', 'shadow', 'space', 'spaceArb', 'motion', 'stroke']) {
      const now = acc[cat], was = base[cat] || 0;
      if (now > was) p.push('TT02 ' + site + ' 的「' + cat + '」从 ' + was + ' 涨到 ' + now + ' —— 棘轮只许减');
      else if (now < was) w.push('TT02 ' + site + ' 的「' + cat + '」从 ' + was + ' 降到 ' + now + ' —— 请跑 --write-registry 跟新台账');
    }
  }
  return { problems: p, warns: w };
}

// ── --selftest：棘轮本身的双向对照（证明它会红，也证明它不误报）────────────
if (process.argv.includes('--selftest')) {
  const Z = { radius: 0, shadow: 0, space: 0, spaceArb: 0, motion: 0, stroke: 0 };
  const fixture = { sites: { 'probe-site': { ...Z, radius: 1 } } };
  const up = compareRatchet({ 'probe-site': { ...Z, radius: 2 } }, fixture);
  const same = compareRatchet({ 'probe-site': { ...Z, radius: 1 } }, fixture);
  const down = compareRatchet({ 'probe-site': { ...Z, radius: 0 } }, fixture);
  const unreg = compareRatchet({ 'not-in-registry': { ...Z } }, fixture);
  const ok =
    up.problems.length === 1 && same.problems.length === 0 && down.problems.length === 0 &&
    down.warns.length === 1 && unreg.problems.length === 0 && unreg.warns.length === 1;
  console.log('棘轮对照：涨 ' + up.problems.length + '（应 1）· 持平 ' + same.problems.length + '（应 0）· 降 ' + down.problems.length + '/警告 ' + down.warns.length + '（应 0/1）· 未登记 ' + unreg.problems.length + '/警告 ' + unreg.warns.length + '（应 0/1）');
  console.log('度量器对照：正例 ' + JSON.stringify(posCats) + ' · 反例命中 ' + negHits + '（应 0）· 哨兵 ' + scanText(SENTINEL).length + '（应 1）· 令牌算式合法 ' + calcOkHits + '（应 0）/ 裸任意值命中 ' + calcBadHits + '（应 4）');
  console.log(ok && !problems.length ? '结论：双向对照通过（该红的红、该绿的不误报）' : '结论：对照失败');
  process.exit(ok && !problems.length ? 0 : 1);
}

const registry = existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, 'utf8')) : null;
const allowance = (registry && registry.ds && registry.ds.allowance) || [];
const key = (h) => h.file + '|' + (h.cls || h.class);

if (!registry) {
  problems.push('TT01 缺少 verification/token-tiers.json —— 站点侧的棘轮要靠它记住基线。用 node scripts/check-token-tiers.mjs --write-registry 生成。');
} else {
  const r = compareRatchet(siteCounts, registry);
  problems.push(...r.problems);
  warns.push(...r.warns);
}
// DS 侧：硬零。不在白名单里的任何一条都是新债。
const allowSet = new Set(allowance.map(key));
for (const h of dsHits) {
  if (!allowSet.has(key(h))) {
    problems.push('TT03 设计系统自身写了档位外的类：' + h.file + ':' + h.line + ' —— ' + h.cls + '（站点被要求用档位，DS 自己必须先是档位）');
  }
}
const allowUsed = new Set(dsHits.map(key));
for (const a of allowance) {
  if (!allowUsed.has(key(a))) {
    warns.push('TT03 白名单里的 ' + key(a) + ' 已经不存在了 —— 删掉这条登记（台账要跟现实一致）');
  }
}

// ── 输出 ────────────────────────────────────────────────────────────────
const CATS = ['radius', 'shadow', 'space', 'spaceArb', 'motion', 'stroke'];
const totals = Object.values(siteCounts).reduce((a, c) => {
  const next = { ...a };
  for (const k of CATS) next[k] = (a[k] || 0) + (c[k] || 0);
  return next;
}, { radius: 0, shadow: 0, space: 0, spaceArb: 0, motion: 0, stroke: 0 });
const dsByCat = dsHits.reduce((a, h) => ({ ...a, [h.cat]: (a[h.cat] || 0) + 1 }), {});

if (AS_JSON) {
  console.log(JSON.stringify({ siteCounts, dsHits, totals, problems, warns, legal: { radius: [...RADIUS], shadow: [...SHADOW], space: [...SPACE], duration: [...DURATION], ease: [...EASE], stroke: STROKE } }, null, 2));
} else {
  console.log('令牌档位闸门：合法档位 radius=' + [...RADIUS].join('/') + ' shadow=' + [...SHADOW].join('/'));
  console.log('              space=' + [...SPACE].join('/'));
  console.log('              duration=' + [...DURATION].join('/') + 'ms · ease=' + [...EASE].join('/') + ' · icon.stroke=' + STROKE + '（全部读自 tokens/tokens.json）');
  console.log('');
  console.log('  站点              圆角   阴影   间距   任意值  动效   描边');
  for (const [s, c] of Object.entries(siteCounts)) {
    console.log('  ' + s.padEnd(16) + CATS.map((k) => String(c[k] || 0).padStart(6)).join(''));
  }
  console.log('  ' + '合计'.padEnd(15) + CATS.map((k) => String(totals[k] || 0).padStart(6)).join(''));
  console.log('');
  console.log('  设计系统自身：' + dsHits.length + ' 处（硬零；过渡期白名单 ' + allowance.length + ' 条 · ' + CATS.map((k) => k + ' ' + (dsByCat[k] || 0)).join(' / ') + '）');
  for (const h of dsHits) console.log('    ' + h.file + ':' + h.line + '  ' + h.cls);
  console.log('');
  for (const w of warns) console.log('  [WARN] ' + w);
  for (const p of problems) console.log('  [FAIL] ' + p);
  console.log('');
  console.log(problems.length ? '结论：' + problems.length + ' 项失败' : '结论：档位收敛（站点侧无新增 · 设计系统自身 ' + dsHits.length + ' 处全部在白名单里）');
}

if (WRITE && !AS_JSON) {
  const next = {
    $comment: '令牌档位台账（棘轮）。站点侧的计数只许减不许增；设计系统自身是硬零，白名单是**过渡期**登记（批次 2 与 ui 发版绑定后必须清空）。生成：node scripts/check-token-tiers.mjs --write-registry。',
    generatedAt: new Date().toISOString().slice(0, 10),
    legal: { radius: [...RADIUS], shadow: [...SHADOW], space: [...SPACE], duration: [...DURATION], ease: [...EASE], stroke: STROKE },
    sites: siteCounts,
    ds: {
      $comment: '设计系统组件里的档位外用法。每一处都必须给出改法与它等的是哪条发版链 —— 空数组是本闸门的终点。',
      allowance: allowance.length ? allowance : dsHits.map((h) => ({ file: h.file, class: h.cls, plan: '批次 2：随 ui rc 发版收敛（见 docs/PORTAL-SHARED-LAYER-DESIGN.md §11 第 55 轮）' })),
    },
  };
  writeFileSync(REGISTRY, JSON.stringify(next, null, 2) + '\n');
  console.log('已写入台账：verification/token-tiers.json（站点 ' + Object.keys(siteCounts).length + ' 个 / DS 白名单 ' + next.ds.allowance.length + ' 条）');
}

process.exit(problems.length ? 1 : 0);
