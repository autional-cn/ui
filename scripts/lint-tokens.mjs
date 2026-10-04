#!/usr/bin/env node
// lint-tokens — 令牌 lint：生成器保证「产物 = SSOT」，这里保证「SSOT 的值本身站得住」
// 用法: node scripts/lint-tokens.mjs [--json]
//
// 与 pnpm gen:check 的分工：
//   gen:check  → 产物是否与 tokens/tokens.json 一致（新鲜度）
//   lint-tokens→ tokens/tokens.json 本身是否正确、是否有冲突、是否满足对比度契约

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, loadTokens, flatten, stripMeta, keysOf, isRef, refPath, makeResolver,
  contextLayers, orderedVariants, variantMap, profileOverridden, themeOverridden,
  cascadeWinner, cssVarName, contrastRatio, parseHex, DIMENSION, DURATION, CUBIC, GRADIENT, SHADOW
} from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const findings = [];
const add = (code, level, key, message, detail) => findings.push({ code, level, key, message, detail: detail || '' });

const T = loadTokens();
const CORE = stripMeta(T.core);
const coreFlat = flatten(CORE);

// ── 上下文：profile × 主题 × 静态主题变体 ────────────────────────────────
const PROFILES = Object.keys(T.profiles);
const THEMES = ['dark'];
// 只检查「有覆盖」的 profile：console / marketing 无覆盖，等价于基线，重复计算没有意义
const EFFECTIVE_PROFILES = PROFILES.filter((p) => Object.keys(flatten(stripMeta(T.profiles[p]))).length > 0);
// 静态「主题变体」也要进 T08 上下文：它们和 light/dark 一样能整体独立生效，但此前
// 从未被对比度契约评估过 —— authenticator 变体 on-brand 对 brand 填充只有 2.77:1
// （审计 F1 家族）就是这样漏掉的（G4 盲区）。
// 挑选判据沿用 T10 的既有口径（变体与 $extends 展开见下方 T10 注释与 lib/tokens.mjs）：
//   · $kind:"runtime"（如 auth-tenant）—— 样式表不落地、变量由页面运行期注入，无常量可断言；
//   · 无 $colorScheme 的浅色面局部覆盖（portal / auth）—— 按设计有意不完整，且 brand 值是
//     运行期 var(--color-brand-base, …) 表达式，静态对比度不可判定（纳入只会产生假红）。
const allVariantNodes = variantMap(T);
const STATIC_THEME_VARIANTS = orderedVariants(T).filter((n) => {
  if (n === 'dark') return false; // 已由 THEMES 枚举，避免重复
  const node = allVariantNodes[n];
  return !!node && node.$kind !== 'runtime' && !!node.$colorScheme;
});
const EXCLUDED_VARIANT_CONTEXTS = orderedVariants(T).filter(
  (n) => n !== 'dark' && !STATIC_THEME_VARIANTS.includes(n),
);
function variantExclusionReason(name) {
  const node = allVariantNodes[name] || {};
  if (node.$kind === 'runtime') return '运行期变体（$kind:"runtime"）：样式表不落地、变量由页面运行期注入';
  return '浅色面局部覆盖（无 $colorScheme）：按设计有意不完整，且 brand 为运行期 var() 表达式，静态不可判定';
}
function contexts() {
  const out = [];
  for (const theme of ['light'].concat(THEMES)) {
    out.push({ name: theme, profile: null, variant: theme === 'dark' ? 'dark' : null });
  }
  for (const p of EFFECTIVE_PROFILES) {
    for (const theme of ['light'].concat(THEMES)) {
      out.push({ name: p + '-' + theme, profile: p, variant: theme === 'dark' ? 'dark' : null });
    }
  }
  // 静态主题变体（当前 = authenticator）：不带 profile —— 变体块在 tokens.css 里最后加载，
  // 且 profiles 的深色守卫选择器已显式 :not([data-theme="authenticator"])。
  for (const v of STATIC_THEME_VARIANTS) {
    out.push({ name: v, profile: null, variant: v });
  }
  return out;
}

// ── T01 命名规则 ──────────────────────────────────────────────────────────
const SEG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// font-size 是「结构化组」：generate.mjs 按 size/lineHeight/fontWeight/letterSpacing 解释，
// 这几个子键是生成器契约的一部分，不算命名违规（但会产出含 camelCase 的 CSS 变量名，见 T01b）
const STRUCTURAL = new Set(['size', 'lineHeight', 'fontWeight', 'letterSpacing']);
for (const path of Object.keys(coreFlat)) {
  const bad = path.split('.').filter((s) => !SEG.test(s) && !STRUCTURAL.has(s));
  if (bad.length) add('T01', 'error', path, '命名段不符合 kebab-case：' + bad.join(', '));
}
const camelVars = Object.keys(coreFlat).filter((p) => /^font-size\./.test(p) && STRUCTURAL.has(p.split('.').pop()));
if (camelVars.length) {
  add('T01b', 'warn', 'font-size.*', '有 ' + camelVars.length + ' 个结构化子键会产出含 camelCase 的 CSS 变量名（如 ' + cssVarName(camelVars[0]) + '）。生成器契约如此，但消费方不能按 kebab 猜名字。');
}

// ── T02 类型正确性 ────────────────────────────────────────────────────────
function classify(path, value) {
  if (typeof value !== 'string') {
    if (Array.isArray(value)) return 'font-stack';
    if (typeof value === 'number') return 'number';
    if (value && typeof value === 'object') return 'object';
    return 'unknown';
  }
  if (isRef(value)) return 'ref';
  if (parseHex(value)) return 'color';
  if (DURATION.test(value)) return 'duration';
  if (CUBIC.test(value)) return 'cubic-bezier';
  if (DIMENSION.test(value)) return 'dimension';
  if (GRADIENT.test(value)) return 'gradient';
  if (SHADOW.test(value)) return 'shadow';
  if (/^\d+(\.\d+)?$/.test(value)) return 'number';
  return 'raw';
}
function expectedFor(path) {
  if (/^color\./.test(path)) return ['color', 'ref'];
  if (/^shadow\./.test(path)) return ['shadow', 'ref'];
  if (/^motion\./.test(path)) return ['duration', 'cubic-bezier', 'ref'];
  if (/^font\./.test(path)) return ['font-stack', 'ref'];
  if (/^(font-size|space|radius|focus)\./.test(path)) return null;
  if (/^image\./.test(path)) return ['gradient', 'raw'];
  if (/^z\.|^layout\.|^a11y\./.test(path)) return ['dimension', 'number', 'raw', 'ref'];
  return null;
}
for (const path of Object.keys(coreFlat)) {
  const value = coreFlat[path];
  const kind = classify(path, value);
  if (kind === 'unknown') { add('T02', 'error', path, '无法识别的值类型：' + JSON.stringify(value)); continue; }
  const expected = expectedFor(path);
  if (expected && !expected.includes(kind)) {
    add('T02', 'error', path, '类型不符：期望 ' + expected.join('|') + '，实际 ' + kind + '（' + JSON.stringify(value) + '）');
  }
}

// ── T03 引用完整性（生成器只在构建时抛首个错误，这里全量列举）────────────
const RESOLVER = makeResolver([CORE]);
for (const path of Object.keys(coreFlat)) {
  const value = coreFlat[path];
  if (!isRef(value)) continue;
  const target = refPath(value);
  if (target.join('.') === path) { add('T03', 'error', path, '自引用：' + value); continue; }
  if (flatten(CORE)[target.join('.')] === undefined && !(target.length === 1 && target[0] in CORE)) {
    // 目标可能是中间节点，用 resolver 再确认
    try { RESOLVER.resolve(value); } catch (e) { add('T03', 'error', path, String(e.message)); }
  }
  try { RESOLVER.resolve(value); } catch (e) { /* 已记录 */ }
}

// ── T04 profile 覆盖悬空 ──────────────────────────────────────────────────
const profileSets = profileOverridden(T);
for (const [name, set] of profileSets) {
  if (!EFFECTIVE_PROFILES.includes(name)) continue;
  for (const p of set) {
    if (coreFlat[p] === undefined) add('T04', 'error', p, 'profile「' + name + '」覆盖了一个 core 里不存在的路径');
  }
}

// ── T05 层叠冲突：profile 的 :root 会压掉变体块（core 层叠顺序是承重的）──
const variantSets = themeOverridden(T);
for (const [name, set] of profileSets) {
  for (const vName of orderedVariants(T)) {
    const vSet = variantSets.get(vName);
    if (!vSet) continue;
    for (const p of set) {
      if (!vSet.has(p)) continue;
      const w = cascadeWinner(T, p, { profile: name, variant: vName });
      if (w.winner && String(w.winner).indexOf('profile:') === 0 && w.value !== w.valueWithoutProfile) {
        add('T05', 'error', p,
          '层叠冲突：profile「' + name + '」的 :root 压掉了变体「' + vName + '」的覆盖',
          '实际生效 ' + JSON.stringify(w.value) + '，本应是 ' + JSON.stringify(w.valueWithoutProfile) +
          '（' + w.selector + ' 在 tokens.css 之后加载，特指度同为 0,1,0 时后者胜）');
      }
    }
  }
}

// ── T06 变体覆盖盘点（信息）──────────────────────────────────────────────
const variantReport = [];
for (const vName of orderedVariants(T)) {
  const set = variantSets.get(vName) || new Set();
  variantReport.push({ variant: vName, overrides: set.size });
}

// ── T10 变体包含：变体之间是互斥选择器，不会层叠 ──────────────────────
// [data-theme=authenticator] 与 .dark 是两个独立选择器。若某变体只覆盖了另一变体的
// 一部分键，它单独应用时，未覆盖的键会**回落到 core 的浅色值**，而不是继承另一变体。
// 实测：authenticator 只覆盖 10 条，dark 覆盖 26 条；单独应用 [data-theme=authenticator]
// 时 --color-neutral-900 得到 #1e293b（浅色值）而不是 #e2edf5，--color-on-brand 得到
// #ffffff 而不是 #0a0f1a —— 形成「深色底 + 浅色文字/品牌色」的坏混合。
const allVariants = variantMap(T);
for (const [name, node] of Object.entries(allVariants)) {
  if (!node || node.$kind === 'runtime') continue;
  const own = new Set(Object.keys(flatten(stripMeta(node))));
  const declared = Array.isArray(node.$requires) ? node.$requires : (node.$requires ? [node.$requires] : []);
  for (const [other, otherNode] of Object.entries(allVariants)) {
    if (other === name || !otherNode || otherNode.$kind === 'runtime') continue;
    const otherSet = new Set(Object.keys(flatten(stripMeta(otherNode))));
    const missingKeys = [...otherSet].filter((k) => !own.has(k));
    if (!missingKeys.length) continue;
    const isSubset = [...own].every((k) => otherSet.has(k));
    if (declared.includes(other)) {
      add('T10', 'error', 'variant:' + name, '声明依赖变体「' + other + '」，但少覆盖 ' + missingKeys.length + ' 个键；单独应用时会回落到 core 的浅色值',
        '缺失示例: ' + missingKeys.slice(0, 6).join(', '));
      continue;
    }
    // 只在「同为某个 colorScheme 的主题变体」之间存在包含关系时才报——那才是真危险：
    // 它会与另一个主题变体互换使用，未覆盖的键会回落到 core（浅色），形成深浅混合。
    // portal / auth 没有 $colorScheme，是「浅色面覆盖」，本就有意地不完整，不在此列。
    const sameScheme = node.$colorScheme && node.$colorScheme === otherNode.$colorScheme;
    if (sameScheme && isSubset && own.size < otherSet.size) {
      add('T10', 'error', 'variant:' + name,
        '变体「' + name + '」与「' + other + '」同为 ' + node.$colorScheme + ' 主题，但覆盖（' + own.size + ' 条）是后者的真子集（' + otherSet.size + ' 条），且未声明依赖',
        '未覆盖的 ' + missingKeys.length + ' 个键在「只加 [data-theme=' + name + '] 而不加 .' + other + '」时会回落到 core 的浅色值：' + missingKeys.slice(0, 6).join(', ') +
        '。二者之一：在 tokens.json 里显式声明 $requires: ["' + other + '"]（把隐式依赖写成契约），或补齐覆盖使其可独立成立。');
    }
  }
}

// ── T07 重复色值（warn：可能是有意的品牌锚点）────────────────────────────
// 例外：chart-* 与某个色阶家族同值是**设计如此**，不是巧合。图表色板现在是钉死的字面量
// （见 tokens/tokens.json 的 $chart-note：刻意不引用 {color.*}，否则 docs/developer 的
// profile 色阶会把分类色一起带走）。因此 chart-N 与对应的 palette 档位同值必然发生。
// 这里不放行整类检查——那个色板有专门的、更强的闸门 scripts/check-chart-palette.mjs
// （逐上下文断言非文本对比度与正常/红绿色盲可区分性），比「重复色值」这条弱警告严格得多。
const isChart = (p) => /^color\.chart\.\d+$/.test(p);
const byValue = new Map();
for (const path of Object.keys(coreFlat)) {
  const v = String(coreFlat[path]).toLowerCase();
  if (!parseHex(v)) continue;
  if (!byValue.has(v)) byValue.set(v, []);
  byValue.get(v).push(path);
}
for (const [v, paths] of byValue) {
  if (paths.length <= 1) continue;
  // 全部同值位置都是 chart-*，或「一个 chart-N + 若干 palette 档位」→ 钉死的分类色，不计。
  if (paths.every(isChart)) continue;
  if (paths.length === 2 && paths.some(isChart)) continue;
  add('T07', 'warn', paths.join(' + '), '同一色值 ' + v + ' 出现在多个位置（若是有意的品牌锚点请登记）');
}

// ── T08 对比度契约 ────────────────────────────────────────────────────────
const pairFile = join(ROOT, 'verification', 'contrast-pairs.json');
let contrastChecked = 0;
if (!existsSync(pairFile)) {
  add('T08', 'warn', 'verification/contrast-pairs.json', '缺少对比度契约文件，跳过对比度检查');
} else {
  const contract = JSON.parse(readFileSync(pairFile, 'utf8'));
  for (const ctx of contexts()) {
    const layers = contextLayers(T, { profile: ctx.profile, variant: ctx.variant });
    const r = makeResolver(layers);
    for (const pair of contract.pairs) {
      const resolvePath = (p) => {
        try { return String(r.resolve('{' + p + '}')); } catch (e) { return null; }
      };
      const fg = resolvePath(pair.fg);
      const bg = resolvePath(pair.bg);
      contrastChecked++;
      if (fg === null || bg === null) {
        add('T08', 'error', ctx.name + ' ' + pair.fg + ' on ' + pair.bg, '令牌无法解析（' + (fg === null ? pair.fg : pair.bg) + '）');
        continue;
      }
      const ratio = contrastRatio(fg, bg);
      if (ratio === null) { add('T08', 'error', ctx.name + ' ' + pair.label, '颜色无法解析：' + fg + ' / ' + bg); continue; }
      if (ratio < pair.min) {
        add('T08', pair.level || 'error', ctx.name + ' ' + pair.fg + ' on ' + pair.bg,
          pair.label + ' 对比度 ' + ratio.toFixed(2) + ':1 < ' + pair.min + ':1',
          fg + ' on ' + bg + '（' + (pair.role || 'body-text') + '）');
      }
    }
  }
}

// ── T11 决策报告是否与当前令牌同源 ──────────────────────────────────────
// 决策文档最容易烂：令牌改了、报告没重生成，读者拿到的就是过期结论。
// 这里只比对「报告记录的令牌快照 hash」与当前锁 hash，不做内容比对。
const deltaJson = join(ROOT, 'verification', 'canonical-decision', 'delta.json');
const lockJson = join(ROOT, 'verification', 'tokens.lock.json');
if (existsSync(deltaJson) && existsSync(lockJson)) {
  const dj = JSON.parse(readFileSync(deltaJson, 'utf8'));
  const lj = JSON.parse(readFileSync(lockJson, 'utf8'));
  if (dj.lockHash && lj.hash && dj.lockHash !== lj.hash) {
    add('T11', 'error', 'verification/canonical-decision/report.md',
      '影响报告基于的令牌快照与当前不一致，结论可能已过期',
      '报告记录 ' + String(dj.lockHash).slice(0, 16) + '，当前 ' + String(lj.hash).slice(0, 16) + '。重新生成：pnpm delta');
  }
} else if (!existsSync(deltaJson)) {
  add('T11', 'warn', 'verification/canonical-decision/', '缺少影响报告，运行 pnpm delta 生成');
}

// ── T09 已知问题登记 ──────────────────────────────────────────────────────
const knownFile = join(ROOT, 'verification', 'known-issues.json');
const known = existsSync(knownFile) ? JSON.parse(readFileSync(knownFile, 'utf8')).issues || [] : [];
const today = new Date().toISOString().slice(0, 10);
for (const k of known) {
  for (const f of ['id', 'code', 'match', 'reason', 'owner', 'expires']) {
    if (!k[f]) add('T09', 'error', 'known-issue:' + (k.id || '?'), '已知问题登记缺少字段 ' + f);
  }
  if (k.expires && k.expires < today) add('T09', 'error', 'known-issue:' + k.id, '登记已过期（' + k.expires + '）：要么修掉，要么重新评估并续期');
}
function isKnown(f) {
  return known.find((k) => k.code === f.code && (f.key.indexOf(k.match) >= 0 || (f.detail || '').indexOf(k.match) >= 0));
}
const suppressed = [];
const active = [];
for (const f of findings) {
  const k = isKnown(f);
  if (k && f.level === 'error') suppressed.push({ finding: f, issue: k });
  else active.push(f);
}

const errors = active.filter((f) => f.level === 'error');
const warns = active.filter((f) => f.level === 'warn');

if (AS_JSON) {
  console.log(JSON.stringify({ errors: errors.length, warnings: warns.length, suppressed: suppressed.length, findings: active, suppressedFindings: suppressed }, null, 2));
} else {
  console.log('令牌 lint：core 叶子 ' + Object.keys(coreFlat).length + ' 条 / profile ' + PROFILES.length + ' 个 / 变体 ' + orderedVariants(T).length + ' 个');
  console.log('  上下文 ' + contexts().length + ' 个 / 对比度检查 ' + contrastChecked + ' 项');
  if (STATIC_THEME_VARIANTS.length) console.log('  T08 含静态主题变体：' + STATIC_THEME_VARIANTS.join('、'));
  if (EXCLUDED_VARIANT_CONTEXTS.length) {
    console.log('  T08 排除变体：' + EXCLUDED_VARIANT_CONTEXTS.map((n) => n + '（' + variantExclusionReason(n) + '）').join('；'));
  }
  for (const v of variantReport) console.log('  变体 ' + v.variant.padEnd(14) + '覆盖 ' + v.overrides + ' 条');
  console.log('');
  for (const f of errors) console.log('  [ERROR] ' + f.code + ' ' + f.key + '  ' + f.message + (f.detail ? '\n          ' + f.detail : ''));
  for (const f of warns) console.log('  [WARN ] ' + f.code + ' ' + f.key + '  ' + f.message);
  for (const s of suppressed) console.log('  [KNOWN] ' + s.finding.code + ' ' + s.finding.key + '  已登记为 ' + s.issue.id + '（owner ' + s.issue.owner + '，到期 ' + s.issue.expires + '）');
  console.log('');
  console.log(errors.length === 0
    ? '结论：令牌 lint 通过（' + warns.length + ' 警告，' + suppressed.length + ' 条已登记问题）'
    : '结论：令牌 lint 失败（' + errors.length + ' 错误，' + suppressed.length + ' 条已登记问题）');
}
process.exit(errors.length === 0 ? 0 : 1);
