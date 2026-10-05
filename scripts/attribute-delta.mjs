#!/usr/bin/env node
// attribute-delta — 「这条棘轮红是谁的？」
// 用法: node scripts/attribute-delta.mjs
//
// 为什么需要它：C5（antd 入口）/ C11（非设计系统色阶）/ C14（lint warning）读的都是**工作区**，
// 不是 git 提交。于是别人**没提交**的改动会让闸门报红，而闸门只会说「变多了」，不会说是谁在什么状态下改的。
// 本会话为此手工写了一次差分脚本，量清了 C5 admin 911→912 的归属（4 个文件 +2/-1）。
// 那种判断不该每次靠人肉 —— 这条命令把「工作区 vs HEAD」逐文件的差一次性列出来。
//
// 判据只做一件事：把「未提交改动会让哪条棘轮动、动多少、在哪个文件」摆出来。
// 它不下结论（谁该修），只给事实。

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { ROOT } from './lib/tokens.mjs';
import { PORTALS } from './lib/portals.mjs';

const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
const APPS = { admin: 'admin-console', platform: 'platform-console', security: 'security-dashboard', user: 'end-user-portal' };

const countAntd = (t) => {
  let n = 0;
  for (const m of t.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"](?:antd|@ant-design\/icons)['"]/g))
    for (const raw of m[1].split(',')) if (raw.trim()) n++;
  return n;
};
const countPalette = (t) => (t.match(/\b(?:text|bg|border)-(?:gray|slate|zinc|stone|red|rose|green|emerald|blue|cyan|indigo|orange|yellow)-\d{2,3}\b|\btext-neutral-400\b/g) || []).length;

const git = (repo, args) => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }); } catch (e) { return null; } };
let rows = 0;
for (const [site, app] of Object.entries(APPS)) {
  const repo = join(SITES, site);
  const rel = 'apps/' + app + '/src';
  const dirty = (git(repo, ['status', '--porcelain']) || '').split('\n').filter(Boolean).map((l) => l.slice(3).trim());
  const mine = dirty.filter((f) => f.startsWith(rel) && /\.(tsx|ts)$/.test(f));
  if (!mine.length) continue;
  const detail = [];
  for (const f of mine) {
    const headText = git(repo, ['show', 'HEAD:' + f]);
    if (headText === null) { detail.push('    ' + f + '（新增文件）'); continue; }
    let nowText = ''; try { nowText = readFileSync(join(repo, f), 'utf8'); } catch (e) { continue; }
    const dAntd = countAntd(nowText) - countAntd(headText);
    const dPal = countPalette(nowText) - countPalette(headText);
    if (dAntd || dPal) detail.push('    ' + (dAntd ? 'antd ' + (dAntd > 0 ? '+' : '') + dAntd + ' ' : '') + (dPal ? '非DS色阶 ' + (dPal > 0 ? '+' : '') + dPal + ' ' : '') + f);
  }
  if (detail.length) { rows++; console.log(site + '：未提交文件里有 ' + detail.length + ' 个会动棘轮'); console.log(detail.join('\n')); }
}
if (!rows) console.log('attribute-delta：四个在册门户的未提交改动都没有动 C5 / C11 的口径 —— 此时闸门若红，红在已提交的代码上。');
