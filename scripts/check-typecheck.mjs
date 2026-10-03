#!/usr/bin/env node
// check-typecheck —— 类型检查闸门
//
// 为什么需要它：本计划第 41 轮补的「发布一致性」管的是 npm 与 SSOT 同步，
// 但**没有任何东西跑过 tsc**。实测后果：@autional-cn/react 的类型检查红了很久没人知道
// （两处错误：缺 @types/react、以及 Uint8Array<ArrayBufferLike> 与 BufferSource 不兼容），
// 而它是对外 SDK —— web / developer / docs 三个站在宣传 "npm install @autional-cn/react"。
// 「没有闸门的检查等于没有检查」在这一条上是最字面的：连跑都没跑过。
//
// 判据分两层：
//   ① ui 工作区：pnpm -r typecheck（设计系统 + shared + react 三个包）
//   ② 在册门户：逐站 tsc --noEmit（四个在册门户）
// 站点未安装 node_modules 时**跳过**并打印 INFO —— 与视觉回归闸门同样的约定：
// 跳过必须在输出里看得见，不能静默当成通过。
//
// 自检：工作区里必须**真的存在**声明了 typecheck 的包，否则 pnpm -r 会「零个包通过」地全绿 ——
// 那正是这道闸门存在的理由（一个不会失败的检查等于没有检查）。

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './lib/tokens.mjs';

const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const PORTALS = [
  { site: 'admin', app: 'apps/admin-console' },
  { site: 'platform', app: 'apps/platform-console' },
  { site: 'security', app: 'apps/security-dashboard' },
  { site: 'user', app: 'apps/end-user-portal' }
];

const problems = [];
const info = [];
const run = (cwd, args) => spawnSync('pnpm', args, { cwd, stdio: 'pipe', shell: process.platform === 'win32', encoding: 'utf8' });

// ── 自检：工作区里真的有人声明 typecheck 吗 ─────────────────────────────
const pkgDirs = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => join(ROOT, 'packages', e.name));
const declared = pkgDirs.filter((d) => {
  const pj = join(d, 'package.json');
  if (!existsSync(pj)) return false;
  try { return !!(JSON.parse(readFileSync(pj, 'utf8')).scripts || {}).typecheck; } catch (e) { return false; }
});
if (!declared.length) {
  problems.push('C12 工作区里没有任何包声明 typecheck 脚本 —— pnpm -r typecheck 会「零个包通过」地全绿，这条闸门就成了一句空话');
}

// ── ① 工作区 ────────────────────────────────────────────────────────────
if (declared.length) {
  const r = run(ROOT, ['-r', 'typecheck']);
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  if (r.status !== 0) {
    const lines = out.split('\n').filter((l) => /error TS|ERR_PNPM|Failed/.test(l)).slice(0, 12);
    problems.push('C12 ui 工作区类型检查失败（' + declared.length + ' 个包）：\n      ' + (lines.join('\n      ') || out.split('\n').slice(-6).join('\n      ')));
  } else {
    info.push('ui 工作区类型检查通过（' + declared.length + ' 个包：' + declared.map((d) => d.split(/[\\/]/).pop()).join(' / ') + '）');
  }
}

// ── ② 在册门户 ──────────────────────────────────────────────────────────
let checked = 0;
const skipped = [];
for (const p of PORTALS) {
  const appDir = join(SITES, p.site, p.app);
  const pj = join(appDir, 'package.json');
  if (!existsSync(pj) || !existsSync(join(appDir, 'node_modules'))) { skipped.push(p.site); continue; }
  const hasTsc = existsSync(join(appDir, 'node_modules', 'typescript')) || existsSync(join(SITES, p.site, 'node_modules', 'typescript'));
  if (!hasTsc) { skipped.push(p.site + '(无 typescript)'); continue; }
  const r = run(appDir, ['exec', 'tsc', '--noEmit']);
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  checked++;
  if (r.status !== 0) {
    const lines = out.split('\n').filter((l) => /error TS/.test(l)).slice(0, 10);
    problems.push('C12 ' + p.site + ' 类型检查失败：\n      ' + (lines.join('\n      ') || out.split('\n').slice(-6).join('\n      ')));
  }
}
info.push('在册门户类型检查：' + checked + ' 个通过' + (skipped.length ? '；跳过 ' + skipped.join('、') + '（未安装，非静默通过）' : ''));
if (checked === 0 && skipped.length) {
  problems.push('C12 四个在册门户**一个都没检查**（' + skipped.join('、') + '）—— 全部跳过等于这道闸门没生效');
}

console.log('类型检查闸门：工作区 ' + declared.length + ' 个包 · 在册门户 ' + checked + ' 个');
for (const l of info) console.log('  [INFO ] ' + l);
for (const l of problems) console.log('  [ERROR] ' + l);
if (problems.length) { console.log('结论：类型检查未通过（' + problems.length + ' 项）'); process.exit(1); }
console.log('结论：类型检查全部通过');
