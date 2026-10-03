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
// 为什么按元素而不是按文件：本轮实测，平台站把 Sidebar.tsx 改成 NavMenu.tsx 之后，
// 「文件还在」但「外壳已经不在了」—— 按文件数验收会把已经收敛的站判成没收敛。
// 反过来，一个叫 AppShell.tsx 的站点文件如果里面写着 <Sider>，按文件名验收又会假绿。
//
// 用法: node scripts/check-shell.mjs [--json]

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { ROOT } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const SITES_DIR = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
// 在册门户（与 §1.3 的外壳表同一批）。其余站点不在本契约范围内。
const PORTALS = [
  { site: 'admin', app: 'apps/admin-console' },
  { site: 'platform', app: 'apps/platform-console' },
  { site: 'security', app: 'apps/security-dashboard' },
  { site: 'user', app: 'apps/end-user-portal' }
];

// 「自己实现的外壳元素」。每一条都要能说清它在说什么，否则它会慢慢长成一张许愿单。
const FORBIDDEN = [
  { re: /<Sider\b/g, why: 'antd 的 <Sider>（侧栏外壳）' },
  { re: /<AntHeader\b/g, why: 'antd 的 <AntHeader>（顶栏外壳）' },
  { re: /const\s*\{[^}]*\bSider\b[^}]*\}\s*=\s*Layout/g, why: '从 antd Layout 解构出 Sider' },
  { re: /const\s*\{[^}]*\bHeader\b[^}]*\}\s*=\s*Layout/g, why: '从 antd Layout 解构出 Header' },
  { re: /<header\b[^>]*className="[^"]*\bsticky\b/g, why: '自己写的 sticky 顶栏' },
  { re: /<aside\b[^>]*className="[^"]*\b(?:inset-y-0|fixed)\b/g, why: '自己写的固定侧栏' }
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

const problems = [];
const rows = [];

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
    problems.push('C13 ' + p.site + '：' + h.file + ' 里仍有「' + h.why + '」—— 自己实现的外壳元素一律改走 <AppShell>（外壳拥有 chrome 与行为，站点只提供内容）。');
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
