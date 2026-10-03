#!/usr/bin/env node
// ⚠️ WIP —— **尚未接入 verify.mjs**。设计已完成、判据已定，但实现里有两个已知缺陷：
//   ① 假阳性：抽取器把 message: 'Something went wrong' 这类 **prose 当成了类名串**
//      → Dev / Error / Boundary / Something / went / wrong 全进了期望集。
//      修法：变体表那一支（LIT_STYLE）要求至少一个 token 带分隔符（- : /），className 那一支不要求。
//   ② 正对照缺失：匹配器存在「CSS 已反转义、模式却仍按转义写」的口径不一致，
//      把含 . 或 / 的类（gap-1.5、bg-danger/10）整体误报为缺失。
//      修法：除负对照（哨兵类必须报缺失）外，再加正对照
//      （flex/hidden/block/w-full/items-center 至少打到一个），防匹配器恒假。
// 教训：**正对照与负对照都要有**。负对照防恒真，正对照防恒假；缺一，闸门的结论都不可信。
// 详见 docs/PORTAL-CONSISTENCY-AUDIT-2026-10-03.md 与 PORTAL-CONSISTENCY-BEAUTIFY-PLAN.md §10。

// 设计系统组件类生成闸门（计划中的 verify 第 19 道）
// 设计系统组件类生成闸门（verify 第 19 道）
// 用法: node scripts/check-ds-classes.mjs [--json]
//
// 守的是什么：一个站点 import 了 @autional-cn/ui 的组件，**不等于**这些组件的样式进了产物。
//
// 实测过的静默失败（2026-10-03 发现）：四个门户的 tailwind content glob 指向
// '../../packages/ui/src' —— 那个目录在组件库改成 npm 依赖时就被删了。结果：
//   admin 85/149、user 35/149、security 99/149、platform 101/149 个类**在产物 CSS 里没有规则**。
// 丢的是 h-4 w-4（图标尺寸）、animate-spin（加载态）、focus-visible:ring-2（焦点环）、
// checked:（开关选中态）这类结构性样式 —— 不是"不好看"，是"半残渲染"。
// 而当时 18 道闸门**全绿**，没有任何信号。组件装了、导入了、渲染了，只是没有样式。
//
// 判据（刻意与机制无关）：**该站 import 到的组件用到的类，必须在该站产物 CSS 里存在。**
//   · 只管"缺"，不管"多" —— 产物里多出用不上的类属包大小问题，不是这道闸门的事。
//   · 因此无论 DS 将来是靠消费方扫 node_modules、还是自己发预编译 CSS，这条判据都成立。
//
// 自带阳性对照（每次都跑）：注入一个必定不存在的哨兵类，匹配器**必须**把它报成缺失。
// 若哨兵"存在"，说明匹配器坏了 —— 那这道闸门就成了永远返回 true 的代码。

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { ROOT } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const PKG = join(ROOT, 'packages', 'ui', 'src');
const SENTINEL = 'dsh-probe-class-that-cannot-exist-zz9';
const problems = [];
const infos = [];

// ── 1. 名字 → 源文件（走 barrel，递归展开目录 index.ts）────────────────────
function buildExportMap(pkgDir) {
  const map = new Map();
  const readBarrel = (rel) => {
    const abs = join(pkgDir, rel);
    if (!existsSync(abs)) return;
    const text = readFileSync(abs, 'utf8');
    const dir = dirname(rel).split('\\').join('/');
    for (const m of text.matchAll(/^export\s+(type\s+)?\{([^}]+)\}\s*from\s*'([^']+)'/gm)) {
      if (m[1]) continue;
      const from = m[3];
      if (from[0] !== '.') continue;
      const target = (dir === '.' ? from : dir + '/' + from).split('\\').join('/');
      for (const raw of m[2].split(',')) {
        const name = raw.trim().split(/\s+as\s+/).pop().trim();
        if (name) map.set(name, target);
      }
    }
    for (const m of text.matchAll(/^export\s+\*\s+from\s*'([^']+)'/gm)) {
      const from = m[1];
      if (from[0] !== '.') continue;
      const sub = (dir === '.' ? from : dir + '/' + from).split('\\').join('/');
      for (const cand of [sub + '/index.ts', sub + '.ts']) if (existsSync(join(pkgDir, cand))) { readBarrel(cand); break; }
    }
  };
  readBarrel('index.ts');
  return map;
}

// 导出表按**每个站实际安装的那份 DS** 来读，不读本地 ui/packages/ui/src。
//
// 为什么（本轮实测踩到）：判据是「你装的这套组件，类生成了没有」。若拿**本地源码**去比对，
// 后果是**每次改 DS 都会让闸门变红** —— 源码领先已发布版本，站点装的是旧版。
// 实测：改完 StatusBadge 之后闸门报 bg-success-soft 缺失，而缺失的原因不是 glob 坏了，
// 是站点装的还是已发布的 rc.3、还没有这次改动。那是**发布流程**的事，不是这道闸门的事。
// 拿站点实装的那份来比，闸门就只对「导入的组件有没有样式」负责 —— 这才是它该管的。
const LOCAL_PKG = PKG;   // 兜底：站点还没装（CI 里只 checkout ui/）时用本地源码

// ── 2. 从源码抽"类名字符串" ────────────────────────────────────────────────
// 两类来源都要抓：
//   (a) className="…" / className={…} 里的字符串字面量
//   (b) 变体表 —— Toast 写的是 success: 'bg-success text-white'，不是 className。
//       只抓 (a) 会把变体表的类全漏掉，而那正是四门户那批缺口的形态之一。
// 过滤：一个字符串只有**每个** token 都长得像 Tailwind 类时才认，避免把中文/句子当类名。
const CLASS_TOKEN = /^!?-?[a-z][a-z0-9]*(?:[-:/.\[\]%(),#][a-z0-9-:\[\]%(),#./]*)*$/i;
const looksLikeClasses = (s) => {
  if (!s || s.length > 300 || /[\u4e00-\u9fa5]/.test(s)) return false;
  const toks = s.trim().split(/\s+/);
  return toks.length > 0 && toks.every((t) => CLASS_TOKEN.test(t));
};
const VARIANT = /^(?:dark|hover|focus|focus-visible|active|disabled|group-hover|md|lg|sm|xl|2xl|checked|peer-checked):/;
const stripVariant = (c) => (VARIANT.test(c) ? c.replace(/^(?:[a-z-]+:)+/, '') : c);
// (a) className 里的字符串：**不要求** token 带分隔符，否则 flex / hidden / truncate 这类单词类会被漏掉
const LIT = /className\s*=\s*["'\u0060]([^"'\u0060\u0024{}]+)["'\u0060]/g;
const LIT_CURLY = /className=\{[^}]*["'\u0060]([^"'\u0060\u0024{}]+)["'\u0060][^}]*\}/g;
// (b) 变体表：形如   success: 'bg-success text-white',
//     这一支**必须**要求至少一个 token 带分隔符（- : /）。
//     否则 message: 'Something went wrong' 会被当成类名串 —— 实测踩到：抽取器把
//     Dev / Error / Boundary / Something / went / wrong 全当成了类，闸门于是报了一堆
//     根本不存在的「缺失类」。假阳性比漏报更贵：它会让整道闸门失去可信度。
const LIT_STYLE = /^\s*[A-Za-z][\w-]*:\s*["'\u0060]([^"'\u0060\u0024{}]+)["'\u0060],?\s*$/gm;
// (c) **模板字符串**：className={`rounded-md transition-colors ${className}`}
//     上面两条抓不到它：LIT / LIT_CURLY 都把 $ 与 {} 排除在外（那正是为了不被插值骗），
//     于是「带插值的 className」整条字符串一个类都抽不出来。
//     实测踩到：brand 只导入 ThemeProvider + ThemeToggle，而 ThemeToggle 的 className 恰好是模板串
//     —— 闸门于是报 D2「导入了 2 个组件但一个类名都抽不到」。那是**闸门自己的假阳性**。
//     模板串里能信的是**静态片段**：先整体取出，再丢掉含 $ 的 token（那是插值，不是类名）。
const LIT_TEMPLATE = /className=\{\s*\u0060([^\u0060]*)\u0060\s*\}/g;
const SEP = /[-:/]/;

function classesInFile(abs, seen) {
  if (seen.has(abs) || !existsSync(abs)) return new Set();
  seen.add(abs);
  const text = readFileSync(abs, 'utf8');
  const out = new Set();
  for (const re of [LIT, LIT_CURLY]) {
    for (const m of text.matchAll(re)) {
      if (!looksLikeClasses(m[1])) continue;
      for (const t of m[1].trim().split(/\s+/)) out.add(t);
    }
  }
  for (const m of text.matchAll(LIT_TEMPLATE)) {
    const statics = m[1].split(/\s+/).filter((t) => t && !t.includes('$'));
    if (statics.length && statics.every((t) => CLASS_TOKEN.test(t))) for (const t of statics) out.add(t);
  }
  for (const m of text.matchAll(LIT_STYLE)) {
    if (!looksLikeClasses(m[1])) continue;
    const toks = m[1].trim().split(/\s+/);
    if (!toks.some((t) => SEP.test(t))) continue;   // 见 LIT_STYLE 上方注释
    for (const t of toks) out.add(t);
  }
  for (const m of text.matchAll(/from\s*'(\.\.?\/[^']+)'/g)) {
    const dir = dirname(abs);
    for (const ext of ['.tsx', '.ts']) {
      const cand = resolve(dir, m[1] + ext);
      if (existsSync(cand)) { for (const c of classesInFile(cand, seen)) out.add(c); break; }
    }
  }
  return out;
}

// ── 3. 站点两侧 ───────────────────────────────────────────────────────────
const SKIP = new Set(['node_modules', '.git', 'dist', '.astro', '.next', 'build', 'coverage', 'public']);
function walk(d, pred, out = []) {
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    if (SKIP.has(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}
function distCss(siteDir) {
  const out = [];
  const direct = join(siteDir, 'dist');
  if (existsSync(direct)) out.push(...walk(direct, (p) => p.endsWith('.css')));
  const apps = join(siteDir, 'apps');
  if (existsSync(apps)) for (const a of readdirSync(apps)) {
    const d = join(apps, a, 'dist');
    if (existsSync(d)) out.push(...walk(d, (p) => p.endsWith('.css')));
  }
  return out;
}
// Tailwind 把 : . / ( ) [ ] 转义成 \: \/ \( …，先还原再匹配，否则 focus-visible:outline-none 永远"缺失"
// 匹配器：**不要**去反转义 CSS，而是把类名按 Tailwind 的规则转义，再对**原始** CSS 做子串查找。
//
// 为什么强调：第一版是「先反转义 CSS，再用转义过的模式去搜」，两边口径不一致，
// 于是含 . / [ ] ( ) 的类（gap-1.5、h-3.5、text-[var(--color-text-primary)]）**被整体误报为缺失**。
// 实测坐实：它们在产物 CSS 里是转义形态且**都在**：
//   .gap-1\\.5 / .h-3\\.5 / .ml-0\\.5 / .text-\\[var\\(--color-text-primary\\)\\]
// 用字符串查找而不是正则，顺带免掉一整类转义事故；边界用「后一个字符不能是 [\w-]」手工判
// （否则 .flex 会命中 .flex-col）。
const TW_ESCAPE = /[!"#\u0024%&'()*+,./:;<=>?@[\\\]^`{|}~]/g;
const twEscape = (c) => c.replace(TW_ESCAPE, (m) => '\\' + m);
const hasRule = (rawCss, cls) => {
  const sel = '.' + twEscape(cls);
  let i = rawCss.indexOf(sel);
  while (i >= 0) {
    const after = rawCss[i + sel.length];
    if (after === undefined || !/[\w-]/.test(after)) return true;
    i = rawCss.indexOf(sel, i + 1);
  }
  return false;
};

if (!existsSync(SITES)) {
  console.log('check-ds-classes：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}

let checkedSites = 0;
let checkedClasses = 0;
const rows = [];

for (const site of readdirSync(SITES)) {
  const siteDir = join(SITES, site);
  if (!statSync(siteDir).isDirectory()) continue;
  const srcFiles = [];
  const roots = [join(siteDir, 'src')];
  const apps = join(siteDir, 'apps');
  if (existsSync(apps)) for (const a of readdirSync(apps)) roots.push(join(apps, a, 'src'));
  for (const r of roots) if (existsSync(r)) srcFiles.push(...walk(r, (p) => /\.(ts|tsx|astro)$/.test(p)));
  if (!srcFiles.length) continue;

  // 站点实际安装的 DS 源码：SPA 在 apps/<app>/node_modules，内容站/根装在站点根
  const candidates = [];
  const appsDir = join(siteDir, 'apps');
  if (existsSync(appsDir)) for (const a of readdirSync(appsDir)) candidates.push(join(appsDir, a, 'node_modules', '@autional-cn', 'ui', 'src'));
  candidates.push(join(siteDir, 'node_modules', '@autional-cn', 'ui', 'src'));
  candidates.push(LOCAL_PKG);
  const pkgDir = candidates.find((d) => existsSync(d));
  const EXPORTS = buildExportMap(pkgDir);
  if (EXPORTS.size === 0) { infos.push('D0 ' + site + '：读不到 @autional-cn/ui 的导出表（' + pkgDir + '）—— 跳过'); continue; }

  const imported = new Set();
  for (const f of srcFiles) {
    for (const m of readFileSync(f, 'utf8').matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s*from\s*'@autional-cn\/ui'/g)) {
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (name && EXPORTS.has(name)) imported.add(name);
      }
    }
  }
  if (!imported.size) continue;

  const cssFiles = distCss(siteDir);
  if (!cssFiles.length) { infos.push('D1 ' + site + '：导入了 ' + imported.size + ' 个 DS 组件，但找不到已构建的 CSS —— 跳过（先 pnpm build）'); continue; }
  const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n');   // 原始字节，不反转义

  const seen = new Set();
  const expected = new Set();
  for (const n of imported) {
    const rel = EXPORTS.get(n);
    for (const ext of ['.tsx', '.ts']) {
      const abs = join(pkgDir, rel + ext);
      if (existsSync(abs)) { for (const c of classesInFile(abs, seen)) expected.add(c); break; }
    }
  }
  if (!expected.size) { problems.push('D2 ' + site + '：导入 ' + imported.size + ' 个 DS 组件但一个类名都抽不到 —— 抽取器坏了，按失败处理'); continue; }

  // 阳性对照，两个哨兵，缺一不可：
  //   ① 负对照：必定**不存在**的类必须被判为缺失（防匹配器恒真）
  //   ② 正对照：必定**存在**的类必须被判为存在（防匹配器恒假）
  // ② 是补上来的。第一版只有 ①，而匹配器当时把含 . 或 / 的类整体误报为缺失，
  // ① 完全看不出来（哨兵类没有特殊字符）。教训：**正对照与负对照都要有**。
  const PRESENT_PROBE = ['flex', 'hidden', 'block', 'w-full', 'items-center'];
  if (hasRule(css, SENTINEL)) { problems.push('D0 阳性对照失败（负）：哨兵类被判为存在 —— 匹配器恒真，结论不可信'); continue; }
  if (!PRESENT_PROBE.some((c) => hasRule(css, c))) {
    problems.push('D0 阳性对照失败（正）：' + PRESENT_PROBE.join(' / ') + ' 一个都找不到 —— 匹配器恒假，结论同样不可信');
    continue;
  }

  const missing = [...expected].filter((c) => !hasRule(css, c));
  checkedSites++; checkedClasses += expected.size;
  rows.push({ site, imported: imported.size, expected: expected.size, missing: missing.length });
  if (missing.length) {
    problems.push('D3 ' + site + '：import 了 ' + imported.size + ' 个 DS 组件，其中 ' + missing.length + '/' + expected.size +
      ' 个类在产物 CSS 里**没有规则**（组件装了、导入了、渲染了，只是没有样式）：' + missing.slice(0, 12).join(', ') + (missing.length > 12 ? ' …' : ''));
  }
}

if (AS_JSON) console.log(JSON.stringify({ rows, checkedSites, checkedClasses, infos, problems }, null, 2));
else {
  console.log('设计系统组件类生成闸门：' + checkedSites + ' 个站 / ' + checkedClasses + ' 个类');
  console.log('');
  for (const r of rows) console.log('  ' + r.site.padEnd(16) + 'DS 组件 ' + String(r.imported).padStart(2) + ' 个   类 ' + String(r.expected).padStart(3) + ' 个   缺 ' + r.missing);
  console.log('');
  for (const i of infos) console.log('  [INFO ] ' + i);
  for (const p of problems) console.log('  [ERROR] ' + p);
  console.log(problems.length ? '结论：有 ' + problems.length + ' 项不达标' : '结论：已导入的 DS 组件类全部生成了（阳性对照通过）');
}
process.exit(problems.length ? 1 : 0);
