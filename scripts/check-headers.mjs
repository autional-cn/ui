#!/usr/bin/env node
// 顶栏契约闸门（verify 第 13 道）
//
// 顶栏是**每个页面都会出现的第一条水平线**。图标套件统一之后（第 12 道闸门），
// 顶栏是紧接着的第二条——高度差 8px 在跨站切换时肉眼可辨，而它是「我们不是同一个
// 产品」最廉价的信号。
//
// 实测（2026-09-29 修复前）：高度跨度 48–117px，position 在 static（admin/platform/
// status/user）与 sticky（其余）之间分成两派，品牌标有三种形态——其中 status 用
// lucide 的 activity、trust 用 lucide 的 shield，把**概念图标**当成了**身份标识**。
//
// 断言：
//   H1 顶层布局里必须存在顶栏元素（<header> 或 antd 的 <AntHeader>）
//   H2 顶栏高度必须来自令牌，不能是写死的数字
//   H3 顶栏 position 必须是 sticky 或 fixed（不能随内容滚走）
//   H4 顶栏里的品牌标必须是品牌资产，不能是图标组件
//
// 用法: node scripts/check-headers.mjs [--json]

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { ROOT } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');

const EXEMPT_PATH = join(ROOT, 'verification', 'header-exemptions.json');
// 「按设计没有顶栏」的站点声明 —— 与豁免不同：那是**有期限的债务登记**，这是**适用范围声明**。
// 两者必须分开：把「本契约不适用」塞进豁免表，会让那张表从"债务清单"变成"杂物抽屉"。
const NO_TOP_BAR = (() => {
  try { return new Set(JSON.parse(readFileSync(join(ROOT, 'verification', 'consumer-targets.json'), 'utf8')).noTopBar || []); }
  catch (e) { return new Set(); }
})();
const TODAY = new Date().toISOString().slice(0, 10);
const exemptions = existsSync(EXEMPT_PATH) ? (JSON.parse(readFileSync(EXEMPT_PATH, 'utf8')).exemptions || []) : [];
const expiredEx = exemptions.filter((e) => e.expires && e.expires < TODAY);
const exemptFor = (rel) => exemptions.find((e) => rel.indexOf(e.match) >= 0);

const problems = [];
const rows = [];

if (!existsSync(SITES)) {
  console.log('check-headers：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}

const SKIPDIR = new Set(['node_modules', '.git', 'dist', '.astro', '.next', 'public', 'build', 'coverage']);
function walk(d, out) {
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of es) {
    if (SKIPDIR.has(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (['.tsx', '.jsx', '.astro', '.html'].includes(extname(e.name))) out.push(p);
  }
  return out;
}

// 判定一个顶栏元素「高度是否来自令牌」。
// 接受三种等价写法——它们的共同点是**值只有一个来源**：
//   h-[var(--layout-header-height)]             Tailwind 任意值
//   height: var(--layout-header-height)         CSS
//   class="site-header"                         设计系统原语（内部已是令牌）
// 不接受：h-16 / h-14 / py-4 这类写死的数字。
const USES_TOKEN = /var\(--layout-header-height\)|site-header\b/;
const HARDCODED_H = /\bh-(?:[0-9]|1[0-9]|2[0-9])\b|\bpy-(?:[0-9])\b|height:\s*\d+px/;
const STICKY = /\b(sticky|fixed)\b|position:\s*(?:sticky|fixed)/;
const ICON_AS_LOGO = /<(?:Activity|Shield|Bell|Zap|Globe|Lock|Server|Gauge|Pulse)\b[^>]*className/;

// ── 共享外壳（AppShell）也是顶栏宿主 ────────────────────────────────────
// 站点把外壳交给设计系统的 <AppShell> 之后，它自己的源码里就**再没有 <header> 了** ——
// 实测踩到：迁移完 user 的 AppShell，H1「零命中不是通过」当场变红，
// 而它变红的原因恰恰是**收敛成功**。这是闸门必须跟着架构走的一个例子。
// 但也不能就此把 <AppShell> 当成免检通道：那会把「改用共享外壳」变成绕过顶栏契约的后门。
// 所以两边都要验：
//   ① 站点确实把外壳交给了 DS；
//   ② DS 那一份**真的**满足契约（同一个令牌高度 + sticky）—— 这一条在这里只验一次。
const SHELL_SRC = join(ROOT, 'packages', 'ui', 'src', 'molecules', 'AppShell.tsx');
let shellOk = false;
if (existsSync(SHELL_SRC)) {
  const s = readFileSync(SHELL_SRC, 'utf8');
  // ⚠ 必须把断言**钉在 <header> 那个标签上**，不能在整份文件里找。
  // 第一版就是「文件里有这个令牌就算过」——阳性对照当场证明它不成立：
  // 侧栏上也有同一个高度令牌，把**顶栏那处**改成 h-16 之后闸门照样全绿。
  // （教训与 C11 那次同型：判据必须落在**它要说的那个元素**上。）
  const headerTag = /<header\b[^>]*>/.exec(s);
  shellOk = !!headerTag && /var\(--layout-header-height\)/.test(headerTag[0]) && /\bsticky\b/.test(headerTag[0]);
} else {
  shellOk = false;
}
// 自检放在常量定义之后：放前面会撞 TDZ（本轮实测踩到第二次，第一次是 C8/C9 的计数器）。
if (!shellOk) {
  problems.push('H2 设计系统的 AppShell 缺失或不满足顶栏契约（需要 ' + SHELL_SRC.replace(/\\/g, '/') +
    ' 里有 var(--layout-header-height) 与 sticky）—— 站点把外壳交给它之后，顶栏契约就没有人满足了');
}

for (const site of readdirSync(SITES)) {
  const dir = join(SITES, site);
  if (!statSync(dir).isDirectory()) continue;
  const hits = [];
  for (const f of walk(dir, [])) {
    const rel = f.replace(/\\/g, '/');
    if (/\/packages\//.test(rel)) continue;              // 交付副本不归本站管
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((ln, i) => {
      // 顶栏不一定叫 <header>。状态站的结构是
      //   <header class="w-full"><div 状态横幅/><nav class="sticky h-[var(...)]">…
      // 真正承担顶栏职责的是那个 sticky 的 <nav>；只认 <header> 会误判。
      // 但 <nav> 太常见（页内目录、侧栏分组），所以只收**自报 sticky/fixed** 的。
      // 三种写法都要认：原生 <header>、antd 的 <AntHeader>（解构自 Layout 后重命名）、
      // antd 的 <Header>（直接解构。security 用的就是这种——只认 <AntHeader> 会漏掉它，
      // 而「漏掉」在这道闸门里等于谎报合规）。
      // <Header\b 不会误匹配 <PageHeader：那要求 '<' 紧跟 'Header'。
      const isHeader = /<header\b|<AntHeader\b|<Header\b/.test(ln);
      const isStickyNav = /<nav\b/.test(ln) && /\b(sticky|fixed)\b|position:\s*(?:sticky|fixed)/.test(ln);
      // <AppShell 只在 DS 那一份满足契约时才算命中；否则下面的 !hits.length 分支会如实报「无顶栏元素」
      const isShell = /<AppShell\b/.test(ln) && shellOk;
      if (!isHeader && !isStickyNav && !isShell) return;
      hits.push({ file: relative(SITES, f).replace(/\\/g, '/'), line: i + 1, text: ln, shell: isShell });
    });
  }
  if (!hits.length) {
    // H1 的失败分支。**此前这里是空的** —— 一个完全没有可识别顶栏的站会显示「—」并通过，
    // 而闸门照样打印「顶栏契约一致（14 站）」。实测坐实：auth 站 0 命中，14 站全绿。
    // 零命中不是通过：它意味着**这道闸门对那个站什么都没验**。
    // 与 contrast 的「0 段文本样本」、CDN 的「连不上 registry 就 SKIP」是同一条纪律。
    // 确属「本站本就没有顶栏」的，走 header-exemptions.json 登记（必须给 owner 与 expires）——
    // 那是**有期限的登记**，不是把问题藏起来。
    rows.push({ site, headers: 0, verdict: '无顶栏元素' });
    const exz = exemptFor(site + '/');
    if (exz) {
      rows[rows.length - 1].tokenOk = '豁免';
      rows[rows.length - 1].stickyOk = '豁免';
      console.log('  [KNOWN] ' + site + ' 无顶栏元素，已登记豁免（owner ' + exz.owner + '，到期 ' + exz.expires + '）');
    } else if (NO_TOP_BAR.has(site)) {
      rows[rows.length - 1].tokenOk = '不适用';
      rows[rows.length - 1].stickyOk = '不适用';
      console.log('  [N/A  ] ' + site + '：consumer-targets.json 声明为「按设计没有顶栏」—— 本契约对该站不适用（声明，不是豁免）');
    } else {
      problems.push('H1 ' + site + '：源码里 0 个可识别的顶栏元素（<header> / <AntHeader> / <Header> / 自报 sticky 的 <nav>）—— ' +
        '闸门对这个站什么都没验。要么让顶栏用其中一种写法，要么在 header-exemptions.json 登记（必须给 owner 与 expires）');
    }
    continue;
  }
  // 逐个候选算分，取**最满足契约**的那个再判定。
  // 不能只取第一个 <header>：status 的结构是
  //   <header class="w-full">        ← 外层，同时装状态横幅与导航
  //     <nav class="sticky h-[var(...)]"> ← 真正承担顶栏职责的是它
  // 只取第一个会把已经改好的站点判成失败（实测踩过）。
  const readAll = (h) => readFileSync(join(SITES, h.file), 'utf8').split(/\r?\n/).slice(h.line - 1, h.line + 7).join('\n');
  const score = (h) => {
    if (h.shell) return 3;                       // 共享外壳：契约由 DS 那份满足（已在上文验过）
    const b = readAll(h);
    const prim = /(^|[\s"'])site-header([\s"']|$)/.test(b);
    return (prim || USES_TOKEN.test(b) ? 2 : 0) + (prim || STICKY.test(b) ? 1 : 0);
  };
  const primary = hits.slice().sort((a, b) => score(b) - score(a))[0];

  // 判定必须看 <header> 元素**及其紧随的若干行**，不能只看那一行。
  // 原因：内容站普遍是两层结构——<header class="sticky top-0"><div class="h-...">——
  // 高度写在**内层容器**上。只看 <header> 那一行会对已经改好的站点报假阳性（实测踩过：
  // developer/brand/docs/trust 四处都被误判）。
  const block = readAll(primary);

  // .site-header 原语自带 position:sticky 与 height:var(--layout-header-height)，
  // 挂了它就等于两项都满足——判定要认得这一点，否则「改用原语」反而被判失败。
  const primitive = /(^|[\s"'])site-header([\s"']|$)/.test(block) || primary.shell;

  const tokenOk = primitive || USES_TOKEN.test(block);
  const stickyOk = primitive || STICKY.test(block);
  const hardcoded = !tokenOk && HARDCODED_H.test(block);
  const iconAsLogo = ICON_AS_LOGO.test(block);

  const ex = exemptFor(primary.file);
  if (ex) {
    rows.push({ site, headers: hits.length, tokenOk: '豁免', stickyOk: '豁免', file: primary.file + ':' + primary.line });
    for (const e of [ex]) console.log('  [KNOWN] 豁免 ' + e.match + '（owner ' + e.owner + '，到期 ' + e.expires + '）');
    continue;
  }
  if (!tokenOk) {
    problems.push('H2 ' + site + '：顶栏高度不是令牌驱动（' + primary.file + ':' + primary.line + '）' +
      (hardcoded ? '——用的是写死的高度' : '') + '；应为 h-[var(--layout-header-height)] 或挂 .site-header');
  }
  if (!stickyOk) problems.push('H3 ' + site + '：顶栏 position 不是 sticky/fixed（' + primary.file + ':' + primary.line + '）——会随内容滚走');
  if (iconAsLogo) problems.push('H4 ' + site + '：顶栏疑似用图标组件充当品牌标（' + primary.file + ':' + primary.line + '）——图标表达概念，品牌标表达身份');

  rows.push({ site, headers: hits.length, tokenOk, stickyOk, file: primary.file + ':' + primary.line });
}

if (AS_JSON) console.log(JSON.stringify({ rows, problems }, null, 2));
else {
  console.log('顶栏契约闸门：' + rows.length + ' 个站点');
  console.log('');
  console.log('  站点'.padEnd(17) + '顶栏数  令牌驱动  sticky');
  for (const r of rows) {
    // 豁免不等于达标——显示成 '免' 而不是 'Y'，否则这张表会谎报合规。
    // 'N/A' 必须与 '—' 分开显示：'—' 是「有元素但没判」（曾经是假绿），'N/A' 是「本契约不适用（已声明）」
    const mark = (v) => (v === '豁免' ? '免' : (v === '不适用' ? 'N/A' : (r.headers === 0 ? '—' : (v ? 'Y' : 'N'))));
    const t = mark(r.tokenOk), s = mark(r.stickyOk);
    console.log('  ' + r.site.padEnd(15) + String(r.headers).padStart(5) + String(t).padStart(9) + String(s).padStart(8));
  }
  console.log('');
  for (const p of problems) console.log('  [ERROR] ' + p);
  console.log(problems.length ? '结论：顶栏契约有 ' + problems.length + ' 项不达标' : '结论：顶栏契约一致（' + rows.length + ' 站）');
}
for (const e of expiredEx) console.log('  [ERROR] 顶栏豁免已过期：' + e.match + '（' + e.expires + '）—— 要么修掉，要么重新评估并续期');
process.exit(problems.length || expiredEx.length ? 1 : 0);
