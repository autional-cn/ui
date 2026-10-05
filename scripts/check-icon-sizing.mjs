#!/usr/bin/env node
// check-icon-sizing — 图标**尺寸纪律**闸门（棘轮）
// 用法: node scripts/check-icon-sizing.mjs [--json] [--write-registry]
//
// 为什么需要它（第 49/50 轮图标迁移留下的、唯一还没被判据看着的纪律）：
//   antd 图标的默认尺寸是 **1em**（继承父级字号），而 lucide 的默认是 **24px** ——
//   直接换等于全站图标放大 1.7 倍。所以两批迁移立下的规矩是「每个图标都带显式尺寸」：
//   控制台一律 size="1em"（原来显式写了字号的转成 size={N}），lucide 原生站用 Tailwind 类
//   （h-4 w-4 / size-5）。**这条纪律此前没有任何判据在看** —— 迁移时的自审是一次性的，
//   下一次有人新加一个图标、或者编辑时把 size 删掉，没有任何东西会响。
//
// 判据（与 C5 / C11 / C14 / 图标词汇同形：只许减不许增）：
//   ① 站点源码里每个 lucide 图标的 JSX 标签必须带显式尺寸：有 size= 属性，
//      或 className 里出现 h-N / w-N / size-N；
//   ② 比台账多 = 报红（新增了一个没尺寸的图标）；比台账少 = 提示更新台账（这是进展）。
//
// 度量器自检两向（见下面那段）。实测两类错都踩过：
//   · authenticator 的 className 用**模板字面量**（h-5 w-5 那种），被漏判成缺尺寸；
//   · trust 的注释「这里此前是 <Shield />」被误判成真实用法。
// 源码里用 \u0060 代替反引号字符，纯粹是为了让本文件能被安全地当作字符串搬运。

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './lib/tokens.mjs';

const BT = String.fromCharCode(96);            // 反引号
const AS_JSON = process.argv.includes('--json');
const WRITE = process.argv.includes('--write-registry');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const REG_PATH = join(ROOT, 'verification', 'icon-sizing.json');

const problems = [];
const warns = [];
const info = [];

if (!existsSync(SITES)) {
  console.log('check-icon-sizing：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}

const SKIP = (e) => ['node_modules', '.git', 'dist', '.astro', '.next', '.turbo', '.vercel', 'public'].includes(e.name);
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

// 开标签的结束位置：尊重字符串与花括号（onClick={() => x} 里的 > 不能截断）
function tagEnd(src, from) {
  let depth = 0, quote = null;
  for (let j = from; j < src.length; j++) {
    const c = src[j];
    if (quote) { if (c === '\\') { j++; continue; } if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === BT) { quote = c; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; continue; }
    if (c === '>' && depth === 0) return j;
  }
  return -1;
}

const SIZE_CLASS = /\b(?:h-\d|w-\d|size-\d)/;
const CLASS_ATTR = new RegExp('\\sclassName\\s*=\\s*(?:\\{)?\\s*(["' + "'" + BT + '])([\\s\\S]*?)\\1');
function tagHasSize(props) {
  if (/\ssize\s*=/.test(props)) return true;
  const m = CLASS_ATTR.exec(props);
  return !!(m && SIZE_CLASS.test(m[2]));
}

const LUCIDE_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]lucide-react['"]/g;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const JSX_COMMENT = new RegExp('\\{\\s*' + '\\/' + '\\*[\\s\\S]*?\\*' + '\\/' + '\\s*\\}', 'g');
const LINE_COMMENT = /^[ \t]*\/\/.*$/gm;

function measureFile(txt) {
  const names = new Set();
  LUCIDE_RE.lastIndex = 0;
  let m;
  while ((m = LUCIDE_RE.exec(txt))) {
    for (const raw of m[1].split(',')) {
      const p = raw.trim();
      if (p) names.add(p.split(/\s+as\s+/).pop().trim());
    }
  }
  if (!names.size) return null;
  // 去掉注释，避免把注释里写的 <Shield /> 当成真实用法
  const code = txt.replace(JSX_COMMENT, ' ').replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, ' ');
  const unsized = [];
  for (const n of names) {
    let i = 0;
    while ((i = code.indexOf('<' + n, i)) !== -1) {
      const after = code[i + 1 + n.length];
      if (after && !/[\s/>]/.test(after)) { i += n.length; continue; }
      const end = tagEnd(code, i + 1 + n.length);
      if (end < 0) break;
      if (!tagHasSize(code.slice(i + 1 + n.length, end))) unsized.push(n);
      i = end + 1;
    }
  }
  return unsized;
}

// ── 自检两向（正例必须判「有尺寸」、反例必须判「没有」）──────────────────
{
  const propsOf = (jsx) => jsx.slice(jsx.indexOf('Bell') + 4, jsx.lastIndexOf('>') - (jsx.endsWith('/>') ? 1 : 0));
  const cases = [
    ['<Bell size="1em" />', true, 'size 属性'],
    ['<Bell className="h-4 w-4" />', true, 'Tailwind 类'],
    ['<Bell className={' + BT + 'h-5 w-5 ' + BT + '} />', true, '模板字面量 className（authenticator 踩过）'],
    ['<Bell className="text-red-500" />', false, '有 className 但没有尺寸类'],
    ['<Bell />', false, '裸标签'],
  ];
  for (const [jsx, want, desc] of cases) {
    const got = tagHasSize(propsOf(jsx));
    if (got !== want) problems.push('图标尺寸度量器自检失败（' + desc + '）：' + jsx + ' 判成 ' + got + '，期望 ' + want);
  }
  const probe = measureFile('import { Shield } from "lucide-react";\nconst a = <div>{/* 这里此前是 <Shield /> */}</div>;');
  if (probe && probe.length) problems.push('图标尺寸度量器自检失败：注释里的 <Shield /> 被计成 ' + probe.length + ' 个真实用法（trust 踩过）');
}

const measured = {};
for (const site of readdirSync(SITES)) {
  const sp = join(SITES, site);
  try { if (!statSync(sp).isDirectory()) continue; } catch (e) { continue; }
  const per = {};
  for (const f of walk(sp, [])) {
    const unsized = measureFile(readFileSync(f, 'utf8'));
    if (!unsized) continue;
    for (const n of unsized) per[n] = (per[n] || 0) + 1;
  }
  if (Object.keys(per).length) measured[site] = per;
}

const REG = existsSync(REG_PATH) ? JSON.parse(readFileSync(REG_PATH, 'utf8')) : { sites: {} };
const was = REG.sites || {};

for (const [site, per] of Object.entries(measured)) {
  for (const [name, n] of Object.entries(per)) {
    const before = (was[site] || {})[name] || 0;
    if (n > before) {
      problems.push('图标尺寸 ' + site + ' 的 <' + name + '> 新增了 ' + (n - before) + ' 个没有显式尺寸的用法（' + before + ' → ' + n +
        '）。antd 图标默认 1em、lucide 默认 24px —— 不写尺寸就是放大 1.7 倍：控制台写 size="1em"，lucide 原生站写 h-4 w-4 / size-5');
    } else if (n < before) {
      warns.push('图标尺寸 ' + site + ' 的 <' + name + '> 从 ' + before + ' 降到 ' + n + ' —— 这是进展，请跑 node scripts/check-icon-sizing.mjs --write-registry');
    }
  }
}
for (const [site, per] of Object.entries(was)) {
  for (const [name, before] of Object.entries(per)) {
    const now = ((measured[site] || {})[name]) || 0;
    if (now === 0 && before > 0) warns.push('图标尺寸 ' + site + ' 的 <' + name + '> 已归零（' + before + ' → 0）—— 跑 --write-registry');
  }
}

info.push('图标尺寸：' + Object.keys(measured).length + ' 个站点有缺尺寸用法，合计 ' +
  Object.values(measured).reduce((a, p) => a + Object.values(p).reduce((x, y) => x + y, 0), 0) + ' 处（台账 ' +
  Object.values(was).reduce((a, p) => a + Object.values(p).reduce((x, y) => x + y, 0), 0) + ' 处）');

if (WRITE) {
  writeFileSync(REG_PATH, JSON.stringify({ $comment: '图标显式尺寸台账（棘轮）。数字只许减不许增：新增一个没写尺寸的 lucide 图标会被判红。', updated: new Date().toISOString().slice(0, 10), sites: measured }, null, 2) + '\n');
  console.log('已写入 verification/icon-sizing.json（' + Object.keys(measured).length + ' 个站点）');
  process.exit(0);
}

if (AS_JSON) {
  console.log(JSON.stringify({ measured, problems, warns, info }, null, 2));
} else {
  for (const i of info) console.log('  [INFO ] ' + i);
  for (const w of warns) console.log('  [WARN ] ' + w);
  for (const p of problems) console.log('  [ERROR] ' + p);
  console.log(problems.length
    ? '结论：图标尺寸检查失败（' + problems.length + ' 错误，' + warns.length + ' 警告）'
    : '结论：图标尺寸检查通过（' + warns.length + ' 警告）');
}
process.exit(problems.length ? 1 : 0);
