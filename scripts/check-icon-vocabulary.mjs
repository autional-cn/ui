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
import { join, resolve, relative, dirname } from 'node:path';
import { createRequire } from 'node:module';
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
const registeredNames = new Set(); // 规范名 + 同义词（覆盖率判据用）
for (const [concept, def] of Object.entries(CONCEPTS)) {
  registeredNames.add(def.canonical);
  for (const s of def.synonyms || []) synonymOf.set(s, { concept, canonical: def.canonical });
  for (const s of def.synonyms || []) registeredNames.add(s);
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

// 同上，但收**全部**用到的名字（覆盖率判据要知道舰队到底用了哪些旧别名）
function countAllNames(txt) {
  const out = new Set();
  for (const m of txt.matchAll(LUCIDE_RE)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) out.add(name);
    }
  }
  return out;
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

// ── 词汇表自检：登记的「同字形对」必须**真的是**同字形 ──────────────────
// 为什么加它（L29）：这张表自称 synonyms 是「lucide 的同字形重命名对」，但这份**数据本身**
// 此前没有任何判据在看。实测 success / success-plain 两条的同义词被**写反了** ——
// CheckCircle2 的真同义词是 CircleCheck，而 CheckCircleBig 属于 CheckCircle；写反之后，
// 闸门会照着这张表去劝别人改名，**等于把人往另一个字形上指**。
// 判据取自 lucide 自己的导出映射（dist/esm/lucide-react.js：每个导出名 → 图标模块），不是 kebab 猜名。
// 同一份映射还用来算「旧别名 → 新名」，供下面的覆盖率判据使用。
const VOCAB_SHIM = new Map();
{
  const load = (() => {
    let pkgPath;
    try {
      pkgPath = createRequire(join(ROOT, 'packages/ui/package.json')).resolve('lucide-react/package.json');
    } catch (e) {
      return { skip: 'lucide-react 未安装（' + (e && e.code) + '）' };
    }
    const esm = join(dirname(pkgPath), 'dist', 'esm', 'lucide-react.js');
    if (!existsSync(esm)) return { skip: 'lucide-react 没有 ESM 导出映射' };
    const map = new Map();
    const RE_EXPORT = /export\s*\{([^}]*)\}\s*from\s*'\.\/icons\/([a-z0-9-]+)\.js'/g;
    for (const m of readFileSync(esm, 'utf8').matchAll(RE_EXPORT)) {
      for (const part of m[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/).pop().trim();
        if (n) map.set(n, m[2]);
      }
    }
    if (map.size < 100) return { skip: 'lucide 导出映射只解析出 ' + map.size + ' 个名字（格式变了？）' };
    return { map };
  })();

  if (load.skip) {
    info.push('图标词汇表自检跳过：' + load.skip);
  } else {
    const glyph = (n) => load.map.get(n);
    // 旧别名 = kebab 名与它指向的图标模块**不一致**的那些（这就是 lucide 的重命名壳）
    const kebabOf = (n) => n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').replace(/([a-zA-Z])(\d)/g, '$1-$2').toLowerCase();
    const canonicalNameOf = new Map();
    for (const [name, id] of load.map) {
      if (name.startsWith('Lucide') || name.endsWith('Icon')) continue;
      if (kebabOf(name) === id) canonicalNameOf.set(id, name);
    }
    for (const [name, id] of load.map) {
      if (name.startsWith('Lucide') || name.endsWith('Icon')) continue;
      if (kebabOf(name) !== id) VOCAB_SHIM.set(name, canonicalNameOf.get(id) || id);
    }
    // 两向对照：正例是**真**同字形，反例是**假**同字形（L29 那一对）—— 两个方向都得对，自检才可信
    for (const [a, b, want] of [['AlertTriangle', 'TriangleAlert', true], ['CheckCircle2', 'CircleCheckBig', false]]) {
      const got = !!glyph(a) && glyph(a) === glyph(b);
      if (got !== want) {
        problems.push('图标词汇表自检的对照失效：' + a + ' / ' + b + ' 判成 ' + got + '，期望 ' + want +
          ' —— 自检本身坏了，它接下来会把对的判错、把错的放过');
      }
    }
    for (const [concept, def] of Object.entries(CONCEPTS)) {
      if (!glyph(def.canonical)) {
        problems.push('图标词汇表 ' + concept + ' 的规范名「' + def.canonical + '」不是 lucide 0.509 的导出名');
        continue;
      }
      for (const s of def.synonyms || []) {
        if (!glyph(s)) {
          problems.push('图标词汇表 ' + concept + ' 的同义词「' + s + '」不是 lucide 0.509 的导出名 —— 它永远写不出来，是死数据');
          continue;
        }
        if (glyph(s) !== glyph(def.canonical)) {
          problems.push('图标词汇表 ' + concept + ' 把「' + s + '」登记成「' + def.canonical + '」的同义词，但它们是**两个字形**（' +
            glyph(s) + ' vs ' + glyph(def.canonical) + '）—— 照这张表改名会改成另一个字');
        }
      }
    }
  }
}

const measured = {};
const usedNamesBySite = {};
let sitesScanned = 0;
for (const site of readdirSync(SITES)) {
  const sp = join(SITES, site);
  try { if (!statSync(sp).isDirectory()) continue; } catch (e) { continue; }
  const per = {};
  const all = new Set();
  for (const f of walk(sp, [])) {
    const txt = readFileSync(f, 'utf8');
    for (const n of countAllNames(txt)) all.add(n);
    const found = countSynonyms(txt);
    for (const [k, v] of Object.entries(found)) per[k] = (per[k] || 0) + v;
  }
  if (all.size) usedNamesBySite[site] = all;
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

// ── 覆盖率判据：舰队用到的每个「旧别名」都必须在 concepts 里有名分 ────────
// 为什么需要它（L28 量化时实测出来的洞）：闸门此前只能判**已登记**的同义词 ——
// 表里没有的旧别名，它的新名写法**没有任何东西在看**。20 个在用旧名里有 7 个没登记
// （UserCircle / Home / Filter / Code2 / ArrowDownCircle / Edit2 / MoreVertical），
// 也就是说「明天有人写 House / Funnel / Pen」当时是**静默**的（不报红、也不进台账）。
// 口径：旧别名**继续用作规范名**（L28 的结论：lucide v1 未删这些别名，没有改名压力），
// 但必须**成对登记**，否则它的新名无人把守。
if (VOCAB_SHIM.size) {
  const unregistered = (names) => [...names].filter((n) => VOCAB_SHIM.has(n) && !registeredNames.has(n));
  // 两向对照：已登记的旧别名不许被报、未登记的旧别名必须被报
  const ctlBad = [...VOCAB_SHIM.keys()].find((n) => !registeredNames.has(n));
  if (unregistered(['AlertTriangle']).length !== 0) {
    problems.push('图标词汇覆盖率自检失败：已登记的 AlertTriangle 被判成未登记');
  }
  if (ctlBad && unregistered([ctlBad]).length !== 1) {
    problems.push('图标词汇覆盖率自检失败：未登记的旧别名 ' + ctlBad + ' 没被判出来 —— 覆盖率判据坏了');
  }
  const inUse = new Set();
  for (const names of Object.values(usedNamesBySite)) for (const n of names) if (VOCAB_SHIM.has(n)) inUse.add(n);
  for (const [site, names] of Object.entries(usedNamesBySite)) {
    for (const n of unregistered(names)) {
      problems.push('图标词汇表缺登记：' + site + ' 用了旧别名「' + n + '」，但它不在 concepts 里 —— 它的新名「' +
        VOCAB_SHIM.get(n) + '」因此无人把守（谁写了都不报）。补一条 concepts（canonical ' + n + '，synonyms 放新名）');
    }
  }
  info.push('图标词汇覆盖率：lucide 共 ' + VOCAB_SHIM.size + ' 个旧别名；舰队在用 ' + inUse.size + ' 个，其中已登记 ' +
    [...inUse].filter((n) => registeredNames.has(n)).length + ' 个');
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
