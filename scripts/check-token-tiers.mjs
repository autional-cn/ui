#!/usr/bin/env node
// check-token-tiers —— 令牌档位闸门（verify 第 28 道）
// 用法: node scripts/check-token-tiers.mjs [--json] [--write-registry]
//
// 守的是什么：**圆角 / 阴影 / 间距只能落在设计系统的档位上。**
//
// 为什么需要它：preset 是 \`theme.extend\` 而不是整表覆盖，所以 Tailwind 的出厂值
// （\`rounded\` 4px、\`shadow-sm/md/lg\`、间距 7/9/11/14/24/28…）**是能生成出来的**。
// 于是这些类不会像裸色阶那样被 K1（写不出来的类）拦下 —— 第 50 轮实测：全舰队 817 处
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
//     裸 \`rounded\` 违规（Tailwind DEFAULT 4px，在档位里没有名字 —— 第 50 轮已补 xs 给它）。
//   · shadow：soft/card/brand/code/deep；\`shadow-none\` 合法。
//   · space：SSOT 的键（含第 50 轮补进 SSOT 的控件密度档 0.5/1.5/2.5/3.5 与节奏档 16/20）；
//     \`-0\` 合法（「无间距」不是档位问题）；任意值 \`-[…]\` 违规。
//
// 度量器自检（学 C5/C9/C10/C11 的做法，双向都要有）：
//   正例 —— 一段必然违规的样本必须被数出来；数不出来说明解析器失灵，棘轮会**全绿**。
//   反例 —— 注释里的类名、\`rounded-none\`、\`-0\`、测试文件里的断言串都不许命中。
//   第 50 轮实测的教训：SectionCard.tsx 顶上的注释就写着 \`rounded-2xl\`（解释为什么不用它），
//   只剥块注释的扫描器会把它当成违规 —— 注释必须**两种都剥**（\`/* */\` 与 \`//\`）。

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { ROOT, TOKENS_PATH, loadTokens } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const WRITE = process.argv.includes('--write-registry');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const REGISTRY = join(ROOT, 'verification', 'token-tiers.json');

// ── 扫描范围：与 check-colors.mjs 同一套 SKIPDIR / SKIPREL（判据之间口径要一致）──
const SKIPDIR = new Set(['node_modules', '.git', 'dist', '.astro', '.next', 'public', 'build', 'coverage', 'generated', '.turbo', 'wiki-src']);
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

/** 剥注释：块注释与行注释都要剥（第 50 轮的实测教训见文件头）。 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

// ── 合法档位：从 SSOT 派生 ────────────────────────────────────────────────
const T = loadTokens();
const keys = (node) => Object.keys(node || {}).filter((k) => !k.startsWith('$'));
const RADIUS = new Set(keys(T.core.radius));
const SHADOW = new Set(keys(T.core.shadow));
const SPACE = new Set(keys(T.core.space));
const DIRS = new Set(['t', 'b', 'l', 'r', 's', 'e', 'tl', 'tr', 'bl', 'br', 'ss', 'se', 'es', 'ee']);
const SPACE_PREFIX = 'p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|bottom|left|right|start|end';
const SENTINEL = 'rounded-zz9-probe dsh-token-tier-probe-zz9';

/** 一段文本里所有「档位外的类」。返回 [{cls, cat, index}] */
export function scanText(text) {
  const s = stripComments(String(text));
  const out = [];
  // 圆角
  for (const m of s.matchAll(/(?<![\w-])rounded(?:-[a-z0-9]+)*(?:-\[[^\]]+\])?/g)) {
    const cls = m[0];
    let parts = cls.split('-').slice(1);
    if (parts.length > 1 && DIRS.has(parts[0])) parts = parts.slice(1);
    const bare = parts.length === 0;
    const logical = parts.length === 1 && parts[0] === 'none';
    const tier = parts.length === 1 && RADIUS.has(parts[0]);
    if (bare || (!tier && !logical)) out.push({ cls, cat: 'radius', index: m.index });
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
    out.push({ cls, cat: 'shadow', index: m.index });
  }
  // 间距
  const re = new RegExp('(?<![\\w-])(?:' + SPACE_PREFIX + ')-(\\d+(?:\\.\\d+)?|\\[[^\\]]+\\])(?![\\w-])', 'g');
  for (const m of s.matchAll(re)) {
    const v = m[1];
    if (v === '0') continue;                       // 「无间距」不是档位问题
    if (SPACE.has(v)) continue;                    // SSOT 的键即合法（含密度档与节奏档）
    out.push({ cls: m[0], cat: 'space', index: m.index });
  }
  return out;
}

// ── 度量器自检（双向）────────────────────────────────────────────────────
const problems = [];
const warns = [];
const POS = '<div class="rounded-2xl shadow-md py-7 rounded">x</div>';
const NEG_BLOCK = '/* rounded-2xl shadow-md py-7 */ <span class="rounded-none shadow-none p-0 gap-0">y</span>';
const NEG_LINE = '// rounded-3xl shadow-lg py-9\n<div class="rounded-xs shadow-card p-1.5 gap-16">z</div>';
const posHits = scanText(POS);
const negHits = scanText(NEG_BLOCK).length + scanText(NEG_LINE).length;
const posCats = { radius: 0, shadow: 0, space: 0 };
for (const h of posHits) posCats[h.cat]++;
if (posCats.radius !== 2 || posCats.shadow !== 1 || posCats.space !== 1) {
  problems.push('TT00 度量器正向控制失败：正例应数出 radius=2 / shadow=1 / space=1，实际 ' + JSON.stringify(posCats) + ' —— 解析器失灵时棘轮会全绿，那比红危险');
}
if (negHits !== 0) {
  problems.push('TT00 度量器负向控制失败：反例（注释里的类名、rounded-none/shadow-none、-0、合法档位）数出了 ' + negHits + ' 条 —— 度量器在误报');
}
if (scanText(SENTINEL).length !== 1) {
  problems.push('TT00 度量器哨兵失败：不可能存在的类没有被数出来 —— 匹配器恒假');
}

// ── 站点侧扫描（棘轮）───────────────────────────────────────────────────
function scanSite(dir) {
  const acc = { radius: 0, shadow: 0, space: 0 };
  for (const f of walk(dir)) {
    const rel = relative(SITES, f).split('\\').join('/');
    if (SKIPREL.some((rx) => rx.test(rel))) continue;
    for (const h of scanText(readFileSync(f, 'utf8'))) acc[h.cat]++;
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
  for (const h of scanText(text)) {
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
    for (const cat of ['radius', 'shadow', 'space']) {
      const now = acc[cat], was = base[cat] || 0;
      if (now > was) p.push('TT02 ' + site + ' 的「' + cat + '」从 ' + was + ' 涨到 ' + now + ' —— 棘轮只许减');
      else if (now < was) w.push('TT02 ' + site + ' 的「' + cat + '」从 ' + was + ' 降到 ' + now + ' —— 请跑 --write-registry 跟新台账');
    }
  }
  return { problems: p, warns: w };
}

// ── --selftest：棘轮本身的双向对照（证明它会红，也证明它不误报）────────────
if (process.argv.includes('--selftest')) {
  const fixture = { sites: { 'probe-site': { radius: 1, shadow: 1, space: 1 } } };
  const up = compareRatchet({ 'probe-site': { radius: 2, shadow: 1, space: 1 } }, fixture);
  const same = compareRatchet({ 'probe-site': { radius: 1, shadow: 1, space: 1 } }, fixture);
  const down = compareRatchet({ 'probe-site': { radius: 0, shadow: 1, space: 1 } }, fixture);
  const unreg = compareRatchet({ 'not-in-registry': { radius: 0, shadow: 0, space: 0 } }, fixture);
  const ok =
    up.problems.length === 1 && same.problems.length === 0 && down.problems.length === 0 &&
    down.warns.length === 1 && unreg.problems.length === 0 && unreg.warns.length === 1;
  console.log('棘轮对照：涨 ' + up.problems.length + '（应 1）· 持平 ' + same.problems.length + '（应 0）· 降 ' + down.problems.length + '/警告 ' + down.warns.length + '（应 0/1）· 未登记 ' + unreg.problems.length + '/警告 ' + unreg.warns.length + '（应 0/1）');
  console.log('度量器对照：正例 ' + JSON.stringify(posCats) + ' · 反例命中 ' + negHits + '（应 0）· 哨兵 ' + scanText(SENTINEL).length + '（应 1）');
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
const totals = Object.values(siteCounts).reduce((a, c) => ({ radius: a.radius + c.radius, shadow: a.shadow + c.shadow, space: a.space + c.space }), { radius: 0, shadow: 0, space: 0 });
const dsByCat = dsHits.reduce((a, h) => ({ ...a, [h.cat]: (a[h.cat] || 0) + 1 }), {});

if (AS_JSON) {
  console.log(JSON.stringify({ siteCounts, dsHits, totals, problems, warns, legal: { radius: [...RADIUS], shadow: [...SHADOW], space: [...SPACE] } }, null, 2));
} else {
  console.log('令牌档位闸门：合法档位 radius=' + [...RADIUS].join('/') + ' shadow=' + [...SHADOW].join('/') + ' space=' + [...SPACE].join('/') + '（读自 tokens/tokens.json）');
  console.log('');
  console.log('  站点              圆角   阴影   间距');
  for (const [s, c] of Object.entries(siteCounts)) {
    console.log('  ' + s.padEnd(16) + String(c.radius).padStart(4) + String(c.shadow).padStart(7) + String(c.space).padStart(7));
  }
  console.log('  ' + '合计'.padEnd(15) + String(totals.radius).padStart(4) + String(totals.shadow).padStart(7) + String(totals.space).padStart(7));
  console.log('');
  console.log('  设计系统自身：' + dsHits.length + ' 处（硬零；过渡期白名单 ' + allowance.length + ' 条 · 圆角 ' + (dsByCat.radius || 0) + ' / 阴影 ' + (dsByCat.shadow || 0) + ' / 间距 ' + (dsByCat.space || 0) + '）');
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
    legal: { radius: [...RADIUS], shadow: [...SHADOW], space: [...SPACE] },
    sites: siteCounts,
    ds: {
      $comment: '设计系统组件里的档位外用法。每一处都必须给出改法与它等的是哪条发版链 —— 空数组是本闸门的终点。',
      allowance: allowance.length ? allowance : dsHits.map((h) => ({ file: h.file, class: h.cls, plan: '批次 2：随 ui rc 发版收敛（见 docs/PORTAL-SHARED-LAYER-DESIGN.md §11 第 50 轮）' })),
    },
  };
  writeFileSync(REGISTRY, JSON.stringify(next, null, 2) + '\n');
  console.log('已写入台账：verification/token-tiers.json（站点 ' + Object.keys(siteCounts).length + ' 个 / DS 白名单 ' + next.ds.allowance.length + ' 条）');
}

process.exit(problems.length ? 1 : 0);
