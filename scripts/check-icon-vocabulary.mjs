#!/usr/bin/env node
// check-icon-vocabulary — 图标**词汇**闸门（棘轮）
// 用法: node scripts/check-icon-vocabulary.mjs [--json] [--write-registry]
//
// 为什么需要它（L26）：
//   设计系统**刻意不收**图标代码层 —— 14 个站里 7 个直连 \`lucide-react\`，DS 自己 15 个组件也直连，
//   再包一层就是零消费者的抽象。但「两个站把同一个概念选成两个不同的名字」这件事，
//   在此之前**没有任何判据在看** —— 而它恰恰是「看起来不像同一个产品」里最细的一处：
//   同一屏里两个只有一笔之差的字形，用户说不出哪里别扭，但会觉得不是一套。
//
// 判据（与 C5 / C11 / C14 同形：只许减不许增）：
//   ① \`concepts\` 里每个概念有一个 canonical 与若干 synonyms（lucide 的**同字形重命名对**）；
//   ② 站点源码里出现 synonym → 计入 \`synonymUsage[site][name]\`；比台账多 = 报红；
//      比台账少 = 提示更新台账；\`converged\` 里的概念一旦再出现 = 报红。
//   ③ 度量器自检两向：正例（synonym）必须命中、反例（canonical / 长得像的别的名字）必须不命中。
//
// 为什么 canonical 取「旧名」：lucide 0.509 里这些旧名是**同字形的别名**（不是废弃标记，
//   d.ts 里带 @deprecated 的只有 17 个品牌图标）。舰队与设计系统当前用的是旧名，
//   换新名是一次 7 站 + DS 的批量改名，收益是零（字形一样）—— 所以列成独立批次（L28），
//   在那之前判据守的是「**别再引入第二种写法**」。

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { ROOT } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const WRITE = process.argv.includes('--write-registry');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const REG_PATH = join(ROOT, 'verification', 'icon-vocabulary.json');

const problems = [];
const warns = [];
const info = [];

if (!existsSync(SITES)) {
  console.log('check-icon-vocabulary：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}
const REG = JSON.parse(readFileSync(REG_PATH, 'utf8'));
const CONCEPTS = REG.concepts || {};
const synonymOf = new Map(); // synonym -> { concept, canonical }
for (const [concept, def] of Object.entries(CONCEPTS)) {
  for (const s of def.synonyms || []) synonymOf.set(s, { concept, canonical: def.canonical });
}

const SKIP = (e) => ['node_modules', '.git', 'dist', '.astro', '.next', '.turbo', '.vercel'].includes(e.name);
function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP(e)) walk(p, out); }
    else if (/\.(tsx|ts|jsx|astro)$/.test(e.name)) out.push(p);
  }
  return out;
}

// ── 度量器：从一段源码里数出用到的同义词（多行 import 也要吃到）──────────────
// ⚠ 不能用 [\s\S]*? —— 它会从文件里第一个 import { 一路吃到下一个 import 的 } 上，
//   把中间那些名字全算进来（C5 的度量器踩过同一个坑，注释也在那里）。
const LUCIDE_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]lucide-react['"]/g;
function countSynonyms(txt) {
  const found = {};
  for (const m of txt.matchAll(LUCIDE_RE)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name && synonymOf.has(name)) found[name] = (found[name] || 0) + 1;
    }
  }
  return found;
}

// ── 自检两向（正例必须命中、反例必须不命中）────────────────────────────
{
  const pos = countSynonyms("import { TriangleAlert, CircleX } from 'lucide-react';");
  const neg = countSynonyms("import { AlertTriangle, XCircle } from 'lucide-react';");
  const neg2 = countSynonyms("import { TriangleAlertX } from 'lucide-react';\nconst s = 'TriangleAlert' in x;");
  if (Object.keys(pos).length !== 2) {
    problems.push('图标词汇度量器正向控制失败：给出 ' + JSON.stringify(pos) + '，期望命中 TriangleAlert 与 CircleX 各 1 次 —— 度量器坏了，棘轮会全绿');
  }
  if (Object.keys(neg).length !== 0) {
    problems.push('图标词汇度量器负向控制失败：只有规范名却被计成 ' + JSON.stringify(neg));
  }
  if (Object.keys(neg2).length !== 0) {
    problems.push('图标词汇度量器负向控制失败：字符串/前缀相似的名字被计成 ' + JSON.stringify(neg2));
  }
}

const measured = {};
let sitesScanned = 0;
for (const site of readdirSync(SITES)) {
  const sp = join(SITES, site);
  try { if (!statSync(sp).isDirectory()) continue; } catch (e) { continue; }
  const per = {};
  for (const f of walk(sp, [])) {
    const found = countSynonyms(readFileSync(f, 'utf8'));
    for (const [k, v] of Object.entries(found)) per[k] = (per[k] || 0) + v;
  }
  if (Object.keys(per).length) { measured[site] = per; sitesScanned++; }
}

// ── 判定 ────────────────────────────────────────────────────────────────
const converged = new Set(REG.converged || []);
for (const [site, per] of Object.entries(measured)) {
  for (const [name, n] of Object.entries(per)) {
    const was = ((REG.synonymUsage || {})[site] || {})[name] || 0;
    const meta = synonymOf.get(name);
    if (converged.has(meta.concept)) {
      problems.push('图标词汇 ' + site + ' 用了「' + name + '」，而概念「' + meta.concept + '」已登记为收敛（该用 ' + meta.canonical + '）—— 收敛的定义是 0 处');
    } else if (n > was) {
      problems.push('图标词汇 ' + site + ' 新增了「' + name + '」（' + was + ' → ' + n + '）。同一个概念只许有一个写法：这里是「' +
        meta.concept + '」，规范名是 ' + meta.canonical + '。两种写法混用 = 同一屏里两个只有一笔之差的字形');
    } else if (n < was) {
      warns.push('图标词汇 ' + site + ' 的「' + name + '」比台账少了（' + was + ' → ' + n + '）——这是进展，跑 node scripts/check-icon-vocabulary.mjs --write-registry 更新台账');
    }
  }
}
for (const [site, per] of Object.entries(REG.synonymUsage || {})) {
  for (const [name, was] of Object.entries(per)) {
    const now = ((measured[site] || {})[name]) || 0;
    if (now === 0 && was > 0) warns.push('图标词汇 ' + site + ' 的「' + name + '」已归零（' + was + ' → 0）——跑 --write-registry 更新台账');
  }
}

const conceptList = Object.entries(CONCEPTS).map(([c, d]) => c + '=' + d.canonical).join(' / ');
info.push('图标词汇：登记 ' + Object.keys(CONCEPTS).length + ' 个概念（' + conceptList + '）');
info.push('图标词汇：' + sitesScanned + ' 个站点有同义词用法，合计 ' +
  Object.values(measured).reduce((a, p) => a + Object.values(p).reduce((x, y) => x + y, 0), 0) + ' 处（台账 ' +
  Object.values(REG.synonymUsage || {}).reduce((a, p) => a + Object.values(p).reduce((x, y) => x + y, 0), 0) + ' 处）');

if (WRITE) {
  const out = { ...REG, updated: new Date().toISOString().slice(0, 10), synonymUsage: measured };
  writeFileSync(REG_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log('已写入 verification/icon-vocabulary.json（' + Object.keys(measured).length + ' 个站点）');
  process.exit(0);
}

if (AS_JSON) {
  console.log(JSON.stringify({ measured, problems, warns, info }, null, 2));
} else {
  for (const i of info) console.log('  [INFO ] ' + i);
  for (const w of warns) console.log('  [WARN ] ' + w);
  for (const p of problems) console.log('  [ERROR] ' + p);
  console.log(problems.length
    ? '结论：图标词汇检查失败（' + problems.length + ' 错误，' + warns.length + ' 警告）'
    : '结论：图标词汇检查通过（' + warns.length + ' 警告）');
}
process.exit(problems.length ? 1 : 0);
