#!/usr/bin/env node
// check-hook-naming — hooks/ 下的文件名与 hook 函数名口径（verify 第 21 道）
// 用法: node scripts/check-hook-naming.mjs [--json]
//
// 为什么需要它（D2 的落地）：实测舰队里 admin / platform / user 的 hooks/ 全部是 kebab-case，
// 只有 **security 全站 camelCase** —— 4 个文件。三站 vs 一站、4 个文件 vs 87 个，
// 所以裁定是把 security 的那 4 个改过来（2026-10-03 已改），而不是让三站倒回去。
// 但裁定只做一次是不够的：没有判据，「下次谁新建一个 useFoo.ts」就没人拦 ——
// 于是这条把口径写成可执行的：**hooks/ 下的文件名一律 kebab-case；hook 函数名一律 useXxx**。
//
// 为什么函数名不跟着文件名走：JS 里 hook 必须以 use 开头才会被 lint 的 hooks 规则识别，
// 那是运行时/工具链约定，与文件怎么命名无关（所以是 use-audit-logs.ts 里写 useAuditLogs）。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ROOT } from './lib/tokens.mjs';

const AS_JSON = process.argv.includes('--json');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const problems = [];
const infos = [];

// kebab-case：小写字母/数字，段之间一个连字符。
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const HOOK_FN = /^use[A-Z][A-Za-z0-9]*$/;

// 度量器正负控制：解析器/匹配器一旦失灵，闸门会全绿 —— 那比红危险。
{
  const ok = ['use-audit-logs', 'use-theme', 'query-keys', 'types'].every((n) => KEBAB.test(n));
  const bad = ['useAuditLogs', 'UseTheme', 'use_theme', 'use-Audit'].some((n) => KEBAB.test(n));
  if (!ok || bad) problems.push('度量器自检失败（kebab 匹配器）：正例/反例判定不符合预期 —— 整道闸门的结论都不可信');
  const fnOk = ['useAuth', 'useTheme', 'usePointTransactions'].every((n) => HOOK_FN.test(n));
  const fnBad = ['useauth', 'UseAuth', 'use_auth'].some((n) => HOOK_FN.test(n));
  if (!fnOk || fnBad) problems.push('度量器自检失败（hook 函数名匹配器）：正例/反例判定不符合预期');
}

const SKIP = new Set(['node_modules', '.git', 'dist', '.astro', '.next']);
function findHookDirs(dir, out, depth = 0) {
  if (depth > 6) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.name === 'hooks') out.push(p);
    else findHookDirs(p, out, depth + 1);
  }
  return out;
}

function walkFiles(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

if (!existsSync(SITES)) {
  console.log('check-hook-naming：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}

const rows = [];
let checkedFiles = 0;
let checkedHookFns = 0;
for (const site of readdirSync(SITES)) {
  const siteDir = join(SITES, site);
  if (!statSync(siteDir).isDirectory()) continue;
  const roots = [join(siteDir, 'src')];
  const apps = join(siteDir, 'apps');
  if (existsSync(apps)) for (const a of readdirSync(apps)) roots.push(join(apps, a, 'src'));
  const hookDirs = [];
  for (const r of roots) if (existsSync(r)) findHookDirs(r, hookDirs);
  let files = 0;
  let fns = 0;
  for (const hd of hookDirs) {
    for (const f of walkFiles(hd, [])) {
      files++;
      const rel = relative(SITES, f).replace(/\\/g, '/');
      const base = f.split(/[\\/]/).pop().replace(/\.(ts|tsx)$/, '').replace(/\.(test|spec)$/, '');
      if (!KEBAB.test(base)) {
        problems.push('hooks 文件名不是 kebab-case：' + rel + '（应以 kebab-case 命名，例如 use-audit-logs.ts；hook 函数名仍写 useAuditLogs）');
      }
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/export\s+(?:async\s+)?function\s+(use[A-Za-z0-9_]*)/g)) {
        fns++;
        if (!HOOK_FN.test(m[1])) problems.push('hook 函数名不合约定：' + rel + ' 的 ' + m[1] + '（应以 use 开头、后接大写字母，如 useAuditLogs）');
      }
      for (const m of text.matchAll(/export\s+const\s+(use[A-Za-z0-9_]*)\s*[=:]/g)) {
        fns++;
        if (!HOOK_FN.test(m[1])) problems.push('hook 函数名不合约定：' + rel + ' 的 ' + m[1] + '（应以 use 开头、后接大写字母）');
      }
    }
  }
  if (files) rows.push({ site, dirs: hookDirs.length, files, fns });
  checkedFiles += files;
  checkedHookFns += fns;
}

if (!checkedFiles) {
  problems.push('一个 hooks/ 目录都没扫到 —— 判据静默失效比误报危险（工程结构变了？还是扫描器坏了？）');
}

if (AS_JSON) console.log(JSON.stringify({ checkedFiles, checkedHookFns, rows, problems, infos }, null, 2));
else {
  console.log('hooks 命名闸门：' + rows.length + ' 个站点 / ' + checkedFiles + ' 个文件 / ' + checkedHookFns + ' 个 hook 函数');
  for (const r of rows) console.log('  ' + r.site.padEnd(14) + 'hooks 目录 ' + String(r.dirs).padStart(2) + ' 个 · 文件 ' + String(r.files).padStart(3) + ' 个 · hook 函数 ' + String(r.fns).padStart(3) + ' 个');
  for (const i of infos) console.log('  [INFO ] ' + i);
  for (const p of problems) console.log('  [ERROR] ' + p);
  console.log('');
  console.log(problems.length ? '结论：hooks 命名有 ' + problems.length + ' 项不达标' : '结论：hooks 命名口径一致（文件名 kebab-case · hook 函数名 useXxx）');
}
process.exit(problems.length ? 1 : 0);
