#!/usr/bin/env node
// check-shell —— 外壳归属闸门（第 23 道）
//
// §9 完成定义第 5 条是「外壳四份 → 0」。在那之前它只是文档里的一句话：
// **没有任何东西在数「还有几个站自己实现外壳」**，于是「收敛到哪一步了」只能靠人去数。
//
// 判据不看文件名，看**源码里有没有自己实现的外壳元素** —— 文件名可以改（Header.tsx → HeaderActions.tsx），
// 但「自己写了一个固定侧栏 / sticky 顶栏」这件事改不了名。
// 四个在册门户必须：
//   ① 使用设计系统的 <AppShell>（把外壳交出去）；
//   ② 源码里不再出现自己实现的外壳元素。
//
// 第 28 轮加了第二条：**页面外框**（沟槽 p-6 + 内容面）也归外壳。它此前散在四个布局文件里
// —— 三个控制台各抄了一份逐字相同的面板、user 一份都没有，而 34 个页面又在面板里再补一层内边距，
// 页面内缩因此在 24px 与 48px 之间随机、同一个门户的相邻两页都能不一样。
// 判据与顶栏那条同型，两边都验：① 站点源码里不再出现外框标记；② DS 那一份真的实现了外框。
//
// 为什么按元素而不是按文件：本轮实测，平台站把 Sidebar.tsx 改成 NavMenu.tsx 之后，
// 「文件还在」但「外壳已经不在了」—— 按文件数验收会把已经收敛的站判成没收敛。
// 反过来，一个叫 AppShell.tsx 的站点文件如果里面写着 <Sider>，按文件名验收又会假绿。
//
// 用法: node scripts/check-shell.mjs [--json]

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { ROOT } from './lib/tokens.mjs';
import { PORTALS } from './lib/portals.mjs';

const AS_JSON = process.argv.includes('--json');
const SITES_DIR = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');

// 「自己实现的外壳元素」。每一条都要能说清它在说什么，否则它会慢慢长成一张许愿单。
const FORBIDDEN = [
  { re: /<Sider\b/g, why: 'antd 的 <Sider>（侧栏外壳）' },
  { re: /<AntHeader\b/g, why: 'antd 的 <AntHeader>（顶栏外壳）' },
  { re: /const\s*\{[^}]*\bSider\b[^}]*\}\s*=\s*Layout/g, why: '从 antd Layout 解构出 Sider' },
  { re: /const\s*\{[^}]*\bHeader\b[^}]*\}\s*=\s*Layout/g, why: '从 antd Layout 解构出 Header' },
  { re: /<header\b[^>]*className="[^"]*\bsticky\b/g, why: '自己写的 sticky 顶栏' },
  { re: /<aside\b[^>]*className="[^"]*\b(?:inset-y-0|fixed)\b/g, why: '自己写的固定侧栏' },
  // 页面外框。这一条挡的是**本轮实测存在过的那种写法**（布局里抄一份 min-h-[calc(100vh…)] 的内容面、
  // 或给外壳传 contentClassName 调沟槽）。换个写法的外框它挡不住 —— 那就靠评审，不假装闸门能做到。
  { re: /min-h-\[calc\(100vh/g, why: '自己写的内容面（页面外框归 <AppShell>）' },
  { re: /contentClassName/g, why: '覆盖外壳的内容区沟槽（留白归 <AppShell>）' }
];
const USES_SHELL = /<AppShell\b/;
// 先剥注释再扫：本轮实测踩到 —— 迁移后的文件里写着「它过去是 <Sider> 外壳」这句解释，
// 不剥注释就会把**解释这件事的注释**判成「还在自己实现外壳」。
// （C2 / C8 / C9 都踩过同一次，这里是第四次；纪律是「扫源码前先剥注释」。）
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

const SKIPDIR = new Set(['node_modules', '.git', 'dist', '.build', '.next', 'public', 'coverage']);
function walk(d, out) {
  let es; try { es = readdirSync(d, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of es) {
    if (SKIPDIR.has(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) { if (e.name === '__tests__' || e.name === 'test') continue; walk(p, out); }
    else if (['.tsx', '.jsx'].includes(extname(e.name))) out.push(p);
  }
  return out;
}

// ── DS 那一份真的实现了外框吗 ──────────────────────────────────────────────
// 与 check-headers 的 H2 同一条教训：站点把外框交出去之后，闸门必须转向 DS，
// 否则「改用共享外壳」会变成绕过外框契约的后门（外壳里根本没有内容面，而四站源码都是干净的）。
const SHELL_SRC = join(ROOT, 'packages', 'ui', 'src', 'molecules', 'AppShell.tsx');
const problems = [];
const rows = [];
{
  // 断言钉在 <main> 那一块上，不在整份文件里找 —— 文件里随便哪处出现 rounded-lg 都不算数。
  const s = existsSync(SHELL_SRC) ? readFileSync(SHELL_SRC, 'utf8') : '';
  const main = /<main\b[\s\S]*?<\/main>/.exec(s);
  const body = main ? main[0] : '';
  const ok = !!body && /rounded-lg/.test(body) && /bg-\[var\(--color-bg-surface\)\]/.test(body) &&
    /\bp-6\b/.test(body) && !/contentClassName/.test(s);
  if (!ok) {
    problems.push('C13 设计系统的 AppShell 不满足页面外框契约（' +
      SHELL_SRC.replace(/\\/g, '/') + ' 的 <main> 里需要 rounded-lg + bg-[var(--color-bg-surface)] + p-6，' +
      '且全文件不含 contentClassName）—— 站点把外框交给它之后，外框就没有人实现了');
  }
}

if (!existsSync(SITES_DIR)) {
  console.log('check-shell：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}

let checked = 0;
for (const p of PORTALS) {
  const src = join(SITES_DIR, p.site, p.app, 'src');
  if (!existsSync(src)) { rows.push({ site: p.site, verdict: '不在本工作区' }); continue; }
  checked++;
  let shellUses = 0;
  const hits = [];
  for (const f of walk(src, [])) {
    const code = stripComments(readFileSync(f, 'utf8'));
    shellUses += (code.match(USES_SHELL) || []).length;
    for (const rule of FORBIDDEN) {
      const m = code.match(rule.re);
      if (m) for (let i = 0; i < m.length; i++) hits.push({ file: relative(SITES_DIR, f).replace(/\\/g, '/'), why: rule.why });
    }
  }
  rows.push({ site: p.site, appShell: shellUses, offenders: hits.length });
  if (!shellUses) {
    problems.push('C13 ' + p.site + '：源码里没有使用设计系统的 <AppShell> —— 四个在册门户的外壳必须交给它（' +
      '§9 第 5 条「外壳四份 → 0」）。要么迁移，要么把它从在册清单里去掉并说明理由。');
  }
  for (const h of hits) {
    problems.push('C13 ' + p.site + '：' + h.file + ' 里仍有「' + h.why + '」—— 外壳（含页面外框）拥有 chrome 与行为，站点只提供内容，一律改走 <AppShell>。');
  }
}

if (AS_JSON) console.log(JSON.stringify({ rows, problems }, null, 2));
else {
  console.log('外壳归属闸门：' + checked + ' 个在册门户');
  console.log('');
  console.log('  站点'.padEnd(17) + 'AppShell 用法  自实现外壳元素');
  for (const r of rows) {
    if (r.verdict) { console.log('  ' + r.site.padEnd(15) + r.verdict.padStart(12)); continue; }
    console.log('  ' + r.site.padEnd(15) + String(r.appShell).padStart(12) + String(r.offenders).padStart(16));
  }
  console.log('');
  for (const p of problems) console.log('  [ERROR] ' + p);
  console.log(problems.length ? '结论：外壳归属有 ' + problems.length + ' 项不达标' : '结论：四个在册门户的外壳都归设计系统');
}
process.exit(problems.length ? 1 : 0);
