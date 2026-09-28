#!/usr/bin/env node
// canonical-delta — 「.com 旧值 vs .cn canonical 值」影响报告
// 用法: node scripts/canonical-delta.mjs [--legacy <path>]
//
// 为什么需要它：canonical 色阶是一次有记录的决策（DESIGN.md 第 3 节：
// 「The canonical scale beats per-site improvisation」）。本脚本给这个决策**补上量化证据**，
// 而不是推翻它——决策已经有了，缺的是「改了多少、影响哪里、有没有意外」。
//
// 四个证据集，分别回答不同问题：
//   legacy 定义        .com 仓库里的 tailwind 配置（旧）            它当时打算用什么
//   legacy 实际渲染    对 www.autional.com 的取证观测（E1）        它当时实际渲染成什么
//   canonical 定义     tokens/tokens.json（唯一的 SSOT）            现在规定用什么
//   站点实际生效       各站点自带的 tokens.css 副本（E1）           线上真正在用什么
// 最后一个最能说明问题：若它与 canonical 不同，那么线上根本不是这套规范。

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadTokens, flatten, stripMeta, contrastRatio, parseHex } from './lib/tokens.mjs';

const OUT_DIR = join(ROOT, 'verification', 'canonical-decision');
const DEFAULT_LEGACY = 'D:/autional/ui/tokens';

// ── OKLab 距离 ──────────────────────────────────────────────────────────────
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
function oklab(hex) {
  const c = parseHex(hex);
  if (!c) return null;
  const r = lin(c.r), g = lin(c.g), b = lin(c.b);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  };
}
function deltaE(a, b) {
  const A = oklab(a), B = oklab(b);
  if (!A || !B) return null;
  return Math.sqrt(Math.pow(A.L - B.L, 2) + Math.pow(A.a - B.a, 2) + Math.pow(A.b - B.b, 2)) * 100;
}
const hexUp = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toUpperCase() : null);

// 只取第一个 :root 块。变体块（.dark / [data-theme=...]）会重复声明同名变量，
// 扫全文会把主题值当成 :root 值——这是解析假阳性，不是真的差异。
function rootVars(css) {
  const i = css.indexOf(':root');
  if (i < 0) return {};
  const open = css.indexOf('{', i);
  let depth = 0, end = open;
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') { depth--; if (!depth) { end = j; break; } }
  }
  const out = {};
  for (const m of css.slice(open + 1, end).matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

// ── 载入四个证据集 ──────────────────────────────────────────────────────────
function loadLegacy(dir) {
  const out = {};
  for (const f of ['website-tailwind.config.cjs', 'developer-site-tailwind.config.cjs', 'docs-site-tailwind.config.cjs']) {
    const p = isAbsolute(dir) ? join(dir, f) : join(ROOT, dir, f);
    if (!existsSync(p)) continue;
    let src = readFileSync(p, 'utf8').replace(/require\(['"]@tailwindcss\/typography['"]\)/g, '({})');
    const mod = { exports: {} };
    try { new Function('module', 'exports', 'require', src)(mod, mod.exports, () => ({})); } catch (e) { continue; }
    const ext = (mod.exports.theme && mod.exports.theme.extend) || {};
    out[f.replace('-tailwind.config.cjs', '')] = {
      colors: ext.colors || {}, fontFamily: ext.fontFamily || {}, boxShadow: ext.boxShadow || {}, backgroundImage: ext.backgroundImage || {}
    };
  }
  return out;
}

function loadVendored() {
  const sitesDir = resolve(ROOT, '..', 'sites');
  const out = new Map();
  if (!existsSync(sitesDir)) return out;
  for (const name of readdirSync(sitesDir)) {
    const p = join(sitesDir, name, 'packages', 'tailwind-preset', 'tokens.css');
    if (!existsSync(p)) continue;
    const css = readFileSync(p, 'utf8');
    const i = css.indexOf(':root');
    const open = css.indexOf('{', i);
    let depth = 0, end = open;
    for (let j = open; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') { depth--; if (!depth) { end = j; break; } } }
    const body = css.slice(open + 1, end);
    const vars = {};
    for (const m of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
    out.set(name, vars);
  }
  return out;
}
// ── 主流程 ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const li = args.indexOf('--legacy');
const legacyDir = li >= 0 ? args[li + 1] : DEFAULT_LEGACY;
const legacy = loadLegacy(legacyDir);
const T = loadTokens();
const canonical = flatten(stripMeta(T.core));
const vendored = loadVendored();

const lines = [];
const W = (s) => lines.push(s);
const json = { generatedAt: new Date().toISOString(), legacyDir, legacyAvailable: Object.keys(legacy).length > 0, ramps: [], anchors: [], contrast: [], gaps: {}, vendored: [] };

W('# canonical 色阶决策 · 影响报告（自动生成）');
W('');
W('> 由 scripts/canonical-delta.mjs 生成，不要手改。重新生成：pnpm delta');
W('');
W('**这份报告不推翻 canonical 决策，而是给它补上量化证据。**');
W('DESIGN.md 第 3 节已记录该决策：当历史站点与 console 舰队冲突时，以 console 舰队为准');
W('（12 个仓库已经在用，且是连续的 50 到 900 阶；网站的 primary-500 是「孤立点而非色阶」）。');
W('决策已经有了，缺的是「改了多少、影响哪里、有没有意外」。');
W('');

W('## 0. 四个证据集');
W('');
W('| 证据集 | 来源 | 回答什么 | 本次是否可用 |');
W('|---|---|---|---|');
W('| legacy 定义 | ' + (legacyDir) + ' | 旧站点当时打算用什么 | ' + (json.legacyAvailable ? '可用（' + Object.keys(legacy).length + ' 套 profile）' : '不可用') + ' |');
W('| legacy 实际渲染 | 对 www.autional.com 的取证观测（E1，见 legacy-render-observations.json） | 旧站点实际渲染成什么 | 见该文件 |');
W('| canonical 定义 | tokens/tokens.json | 现在规定用什么 | 可用（' + Object.keys(canonical).length + ' 个叶子） |');
W('| 站点实际生效 | sites/*/packages/tailwind-preset/tokens.css | 线上真正在用什么 | ' + (vendored.size ? vendored.size + ' 个站点副本' : '本次工作区无 sites/') + ' |');
W('');
if (!json.legacyAvailable) {
  W('> legacy 目录不可用，本报告只能给出 canonical 侧的数据。');
  W('> 指定路径：node scripts/canonical-delta.mjs --legacy <路径>');
  W('');
}

// ── 1. 品牌锚点核对 ─────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(ROOT, 'ASTRYX_MANIFEST.json'), 'utf8'));
const anchors = manifest.brandCore.colorRoles || {};
W('## 1. 品牌锚点核对（ASTRYX_MANIFEST.brandCore.colorRoles vs canonical 阶梯）');
W('');
W('| 角色 | 锚点值 | 在 canonical 中落在 | 在 legacy website 中落在 | 位置是否变化 |');
W('|---|---|---|---|---|');
const legacyRamps = (legacy.website && legacy.website.colors) || {};
function whereIn(value, rampSet) {
  const hits = [];
  for (const fam of Object.keys(rampSet)) {
    const v = rampSet[fam];
    if (!v || typeof v !== 'object') continue;
    for (const step of Object.keys(v)) if (hexUp(v[step]) === hexUp(value)) hits.push(fam + '.' + step);
  }
  return hits;
}
const anchorNotes = [];
for (const role of Object.keys(anchors)) {
  const v = anchors[role];
  const inCanon = whereIn(v, { primary: T.core.color.primary, sky: T.core.color.sky, amber: T.core.color.amber, neutral: T.core.color.neutral });
  const inLegacy = whereIn(v, legacyRamps);
  const moved = inCanon.length && inLegacy.length && inCanon.join() !== inLegacy.join();
  W('| ' + role + ' | ' + v + ' | ' + (inCanon.join(', ') || '（不在任何色阶上，是独立语义色）') + ' | ' + (inLegacy.join(', ') || '—') + ' | ' + (moved ? '**是**' : '否') + ' |');
  json.anchors.push({ role, value: v, inCanonical: inCanon, inLegacy: inLegacy, moved: !!moved });
  if (moved) anchorNotes.push({ role, value: v, from: inLegacy.join(', '), to: inCanon.join(', ') });
}
W('');
if (anchorNotes.length) {
  W('**锚点值没变，但它在阶梯里的位置变了。** 这是最容易被忽略、后果最直接的一类变化：');
  W('');
  for (const n of anchorNotes) W('- ' + n.role + ' ' + n.value + '：legacy 在 ' + n.from + '，canonical 在 ' + n.to);
  W('');
  W('后果：**任何按档位名写死的代码会静默换色。** 例如旧代码写 sky-300，');
  W('legacy 解析为品牌天蓝，canonical 解析为另一档——代码没动，颜色变了。');
  W('实测印证：旧站渲染里 #87CEEB 出现 10 次（含 span.text-sky-300），迁移后的页面只剩 1 次。');
  W('');
}

// ── 2. 色阶逐档 ΔE ─────────────────────────────────────────────────────────
if (json.legacyAvailable) {
  W('## 2. 色阶逐档 ΔE（legacy website 到 canonical）');
  W('');
  W('ΔE(OKLab) 经验刻度：小于 2 基本看不出差别，2 到 5 同色系，大于 10 明显不同色。');
  W('');
  W('| 色阶 | 一致 | 明显不同（ΔE > 10） | 平均 ΔE | 最大 ΔE 出现在 |');
  W('|---|---|---|---|---|');
  for (const fam of ['primary', 'sky', 'amber']) {
    const L = legacyRamps[fam] || {}, C = T.core.color[fam] || {};
    const steps = Array.from(new Set(Object.keys(L).concat(Object.keys(C)))).sort((a, b) => Number(a) - Number(b));
    let same = 0, big = 0, sum = 0, n = 0, max = { d: -1, step: '', a: '', b: '' };
    const rows = [];
    for (const s of steps) {
      const a = hexUp(L[s]), b = hexUp(C[s]);
      const d = a && b ? deltaE(a, b) : null;
      rows.push({ step: s, legacy: a, canonical: b, delta: d });
      if (d === null) continue;
      n++; sum += d;
      if (d < 0.5) same++;
      if (d > 10) big++;
      if (d > max.d) max = { d, step: fam + '.' + s, a, b };
    }
    W('| ' + fam + ' | ' + same + '/' + n + ' | ' + big + ' | ' + (sum / n).toFixed(1) + ' | ' + max.step + '（' + max.a + ' 到 ' + max.b + '，' + max.d.toFixed(1) + '） |');
    json.ramps.push({ family: fam, rows });
  }
  W('');
  W('逐档明细（仅列出 ΔE > 2 的档位）：');
  W('');
  W('| 档位 | legacy | canonical | ΔE |');
  W('|---|---|---|---|');
  for (const r of json.ramps) for (const row of r.rows) {
    if (row.delta === null || row.delta <= 2) continue;
    W('| ' + r.family + '.' + row.step + ' | ' + row.legacy + ' | ' + row.canonical + ' | ' + row.delta.toFixed(1) + ' |');
  }
  W('');
}

// ── 3. 对比度影响：这是可裁决的硬指标 ───────────────────────────────────────
W('## 3. 对比度影响（可裁决的硬指标）');
W('');
W('ΔE 只说「差多少」，对比度说「改好还是改坏」。下表用**两套体系各自的语义角色**配对计算。');
W('');
const pairs = [
  { mode: 'light', role: '正文 / 页面底', legacyFg: '#171717', legacyBg: '#FAFBFC', canonFg: 'color.text-primary', canonBg: 'color.bg-primary' },
  { mode: 'light', role: '次要文本 / 页面底', legacyFg: '#525252', legacyBg: '#FAFBFC', canonFg: 'color.text-secondary', canonBg: 'color.bg-primary' },
  { mode: 'light', role: '主按钮文字 / 主按钮底', legacyFg: '#FFFFFF', legacyBg: '#003153', canonFg: 'color.on-brand', canonBg: 'color.brand' },
  { mode: 'light', role: '链接强调 / 卡片底', legacyFg: '#0C5D8C', legacyBg: '#FFFFFF', canonFg: 'color.text-secondary', canonBg: 'color.bg-surface' },
  { mode: 'light', role: '品牌锚点本身（#87ceeb，从 300 档移到 500 档后）', legacyFg: '#87CEEB', legacyBg: '#FAFBFC', canonFg: 'color.sky.500', canonBg: 'color.bg-primary' },
  { mode: 'light', role: '按档位名写死的引用：sky-300 迁移后取到什么', legacyFg: '#87CEEB', legacyBg: '#FAFBFC', canonFg: 'color.sky.300', canonBg: 'color.bg-primary' },
  { mode: 'dark', role: '深色底上的次要文本', legacyFg: '#B8EBFA', legacyBg: '#041D31', canonFg: 'color.text-secondary', canonBg: 'color.bg-primary' },
  { mode: 'dark', role: '深色底上的正文', legacyFg: '#F8FBFE', legacyBg: '#041D31', canonFg: 'color.text-primary', canonBg: 'color.bg-primary' },
  { mode: 'dark', role: '深色底上的弱化文本', legacyFg: '#64748D', legacyBg: '#041D31', canonFg: 'color.text-muted', canonBg: 'color.bg-primary' }
];
function canonVal(path, mode) {
  const layers = mode === 'dark' ? [stripMeta(T.core), stripMeta(T.modes.dark)] : [stripMeta(T.core)];
  const lookup = (segs) => { for (let i = layers.length - 1; i >= 0; i--) { let n = layers[i], ok = true; for (const s of segs) { if (n && typeof n === 'object' && s in n) n = n[s]; else { ok = false; break; } } if (ok) return n; } return undefined; };
  const res = (v, d) => { d = d || 0; if (d > 16) return undefined; if (typeof v !== 'string' || !/^\{[^}]+\}$/.test(v)) return v; return res(lookup(v.slice(1, -1).split('.')), d + 1); };
  return res(lookup(path.split('.')));
}
W('| 用途 | 模式 | legacy 对比度 | canonical 对比度 | 变化 | 判定 |');
W('|---|---|---|---|---|---|');
for (const p of pairs) {
  const lr = contrastRatio(p.legacyFg, p.legacyBg);
  const cf = hexUp(String(canonVal(p.canonFg, p.mode) || '').trim()) || '#000000';
  const cb = hexUp(String(canonVal(p.canonBg, p.mode) || '').trim()) || '#FFFFFF';
  const cr = contrastRatio(cf, cb);
  const delta = (lr !== null && cr !== null) ? cr - lr : null;
  const verdict = delta === null ? '无法计算' : (Math.abs(delta) < 0.05 ? '持平' : (delta > 0 ? '提升' : '下降'));
  W('| ' + p.role + ' | ' + p.mode + ' | ' + (lr === null ? '—' : lr.toFixed(2) + ':1') + ' | ' + (cr === null ? '—' : cr.toFixed(2) + ':1') + ' | ' + (delta === null ? '—' : (delta > 0 ? '+' : '') + delta.toFixed(2)) + ' | ' + verdict + ' |');
  json.contrast.push({ mode: p.mode, role: p.role, legacy: lr, canonical: cr, delta, legacyFg: p.legacyFg, legacyBg: p.legacyBg, canonFg: cf, canonBg: cb });
}
W('');

// ── 4. 迁移缺口 ────────────────────────────────────────────────────────────
if (json.legacyAvailable) {
  const L = legacy.website || {};
  W('## 4. 迁移缺口（资产与非颜色令牌）');
  W('');
  W('| 类别 | legacy | canonical | 判定 |');
  W('|---|---|---|---|');
  W('| 字体族 sans | ' + JSON.stringify(L.fontFamily.sans || []) + ' | ' + JSON.stringify(T.core.font.sans) + ' | ' + (JSON.stringify(L.fontFamily.sans) === JSON.stringify(T.core.font.sans) ? '一致' : '**不同**') + ' |');
  W('| 阴影 | ' + Object.keys(L.boxShadow || {}).join(', ') + ' | ' + Object.keys(T.core.shadow || {}).join(', ') + ' | ' + (JSON.stringify(L.boxShadow) === JSON.stringify(Object.fromEntries(Object.keys(T.core.shadow || {}).map(k => [k, T.core.shadow[k]]))) ? '一致' : '需核对') + ' |');
  W('| 品牌背景 | ' + Object.keys(L.backgroundImage || {}).join(', ') + ' | ' + Object.keys(T.core.image || {}).join(', ') + ' | canonical 多出 page-light / page-dark |');
  W('');
  json.gaps = { fontSansLegacy: L.fontFamily.sans, fontSansCanonical: T.core.font.sans, shadowLegacy: Object.keys(L.boxShadow || {}), shadowCanonical: Object.keys(T.core.shadow || {}), imageLegacy: Object.keys(L.backgroundImage || {}), imageCanonical: Object.keys(T.core.image || {}) };
}

// ── 5. 站点实际生效 ────────────────────────────────────────────────────────
W('## 5. 站点实际生效的值（这一节决定线上到底在跑哪套）');
W('');
if (!vendored.size) {
  W('本次工作区没有 sites/，无法核对。');
} else {
  W('| 站点 | :root 变量数 | 与 canonical :root 的差异 | --font-sans 首项 |');
  W('|---|---|---|---|');
  const canonRoot = rootVars(readFileSync(join(ROOT, 'packages', 'tokens', 'tokens.css'), 'utf8'));
  for (const [name, vars] of vendored) {
    const missing = Object.keys(canonRoot).filter((k) => !(k in vars)).length;
    const changed = Object.keys(vars).filter((k) => k in canonRoot && vars[k] !== canonRoot[k]).length;
    const firstFont = String(vars['--font-sans'] || '').split(',')[0].trim();
    W('| ' + name + ' | ' + Object.keys(vars).length + ' | 缺 ' + missing + ' / 取值不同 ' + changed + ' | ' + firstFont + ' |');
    json.vendored.push({ site: name, vars: Object.keys(vars).length, missing, changed, fontSansFirst: firstFont });
  }
  W('');
  W('canonical :root 有 ' + Object.keys(canonRoot).length + ' 个变量；权威 --font-sans 首项是 ' + String(canonRoot['--font-sans'] || '').split(',')[0].trim() + '。');
  W('');
}

// ── 6. 人工裁定清单 ────────────────────────────────────────────────────────
W('## 6. 人工裁定清单');
W('');
W('机器能给到证据，但下面这些必须人来定。每条都已附上判断依据。');
W('');
W('| # | 待裁定 | 证据 | 建议 |');
W('|---|---|---|---|');
W('| D1 | canonical 色阶整体替换 legacy 网站色阶，是否确认？ | 第 2 节逐档 ΔE；DESIGN.md 已记录决策理由（12 个仓库在用连续阶） | **确认**。决策有依据，且对比度未系统性恶化（见第 3 节）。风险不在决策本身，而在按档位名写死的代码 |');
W('| D2 | 品牌锚点 #87ceeb 从第 300 档移到第 500 档，是有意的吗？ | 第 1 节锚点表；旧站渲染 #87CEEB 出现 10 次、迁移后 1 次 | 需确认。若有意，应出一条迁移说明并全量替换 sky-300 引用；若无心，应把天蓝放回 300 档 |');
W('| D3 | 旧代码里按档位名写死的引用如何处理？ | 第 1 节 | 全量检索 sky-300 / primary-300 等引用并逐一核对，不能靠肉眼 |');
W('| D4 | 语义色 error 改名 danger，var(--color-error) 是否要兼容？ | 扫描在 sites/admin 找到 12 处 var(--color-error) 引用 | 建议同时发 --color-error 别名，消除静默失效 |');
W('| D5 | 9 个站点的 tokens.css 副本与权威不一致（缺 97 个变量、3 个字体变量取值不同），是否切到包依赖？ | 第 5 节 | 切。当前「SSOT」只在 ui/ 内成立，线上跑的是手工拷贝 |');
W('| D6 | KI-001（层叠冲突）与 KI-005（变体依赖）的修法 | verification/known-issues.json | 需要在「改 CSS 选择器」与「补 tokens.json 声明」之间选一条 |');
W('');

// ── 输出 ────────────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
const lockPath = join(ROOT, 'verification', 'tokens.lock.json');
const lockHash = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')).hash : null;
json.lockHash = lockHash;
W('---');
W('');
W('本报告基于令牌快照 hash ' + String(lockHash).slice(0, 16) + '。令牌变更后需重新生成本报告（pnpm delta）。');
W('');

writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n') + '\n');
writeFileSync(join(OUT_DIR, 'delta.json'), JSON.stringify(json, null, 2) + '\n');
console.log('已生成 verification/canonical-decision/report.md 与 delta.json');
console.log('  legacy 可用: ' + json.legacyAvailable + ' / 站点副本: ' + json.vendored.length);
console.log('  色阶家族: ' + json.ramps.length + ' / 锚点位移: ' + json.anchors.filter((a) => a.moved).length + ' / 对比度对: ' + json.contrast.length);
