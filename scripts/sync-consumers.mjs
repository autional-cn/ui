#!/usr/bin/env node
// sync-consumers — 把权威产物同步到站点的内置副本
// 用法:
//   node scripts/sync-consumers.mjs           # 只报告会改什么（默认，不写盘）
//   node scripts/sync-consumers.mjs --write   # 实际写入
//
// 为什么需要它（实测 2026-09）：
//   9 个站点各自在**自己仓库内**有一个 packages/tailwind-preset，锁文件解析为
//     '@autional-cn/tailwind-preset': { specifier: workspace:*, version: link:../../packages/tailwind-preset }
//   于是站点里的 `@import '@autional-cn/tailwind-preset/tokens.css'` 用的是它自己的内置分支。
//   命名空间是伪造的——读起来像在消费设计系统，实际没有。这是 KI-006 的机制。
//   更麻烦的是两边形态都不一样：权威 packages/tailwind-preset/tokens.css 是 254 字节的
//   转发文件（@import '@autional-cn/tokens/tokens.css'），站点副本是 6.5KB 的内联快照，
//   来自更早的一代（primary-50 是 #e8f1f8，权威已是 #e9f3f9）。所以「复制粘贴」修不了，
//   必须**生成**：本脚本把权威的完整内联产物写进站点，使其自洽且与权威逐字节一致，
//   之后由 check-consumers.mjs 守住不再漂移。
//
// 副作用提示：本脚本会改变站点的渲染（新增缺失变量、更新 border-strong 与字体栈）。
// 对每个站点都应先构建并跑视觉回归再接受。

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './lib/tokens.mjs';

const WRITE = process.argv.includes('--write');
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');

// 写入站点的那份 tokens.css 用**完整内联产物**而不是转发文件，
// 站点只 link 了 tailwind-preset 一个包，@import '@autional-cn/tokens/…' 在那里解析不到。
const SOURCES = [
  { from: 'packages/tokens/tokens.css', to: 'packages/tailwind-preset/tokens.css' },
  { from: 'packages/tailwind-preset/index.js', to: 'packages/tailwind-preset/index.js' },
  { from: 'packages/tailwind-preset/index.d.ts', to: 'packages/tailwind-preset/index.d.ts' },
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

if (!existsSync(SITES)) {
  console.log('sync-consumers：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}

const targets = [];
for (const site of readdirSync(SITES)) {
  const sitePath = join(SITES, site);
  if (!statSync(sitePath).isDirectory()) continue;
  if (!existsSync(join(sitePath, 'packages', 'tailwind-preset'))) continue;
  targets.push({ site, sitePath });
}

let changed = 0;
let same = 0;
const rows = [];
for (const { site, sitePath } of targets) {
  for (const { from, to } of SOURCES) {
    const src = join(ROOT, from);
    const dst = join(sitePath, to);
    if (!existsSync(src)) { rows.push('  [缺失源] ' + from); continue; }
    const a = readFileSync(src);
    const b = existsSync(dst) ? readFileSync(dst) : null;
    if (b && sha(a) === sha(b)) { same++; continue; }
    changed++;
    const before = b ? b.length + 'B/' + sha(b) : '(不存在)';
    rows.push('  ' + site.padEnd(15) + to.replace('packages/tailwind-preset/', '') .padEnd(13) +
      before.padEnd(22) + ' -> ' + a.length + 'B/' + sha(a));
    if (WRITE) {
      mkdirSync(join(sitePath, 'packages', 'tailwind-preset'), { recursive: true });
      writeFileSync(dst, a);
    }
  }
}

console.log('站点内置副本同步：' + targets.length + ' 个站点 / ' + SOURCES.length + ' 个文件');
console.log('  逐字节一致 ' + same + ' 个 / 需要更新 ' + changed + ' 个');
if (rows.length) {
  console.log('');
  console.log('  站点'.padEnd(17) + '文件'.padEnd(15) + '当前'.padEnd(24) + '权威');
  for (const r of rows) console.log(r);
}
console.log('');
if (WRITE) {
  console.log(changed ? '已写入 ' + changed + ' 个文件。请逐站构建并跑视觉回归后再提交。'
    : '无需改动。');
} else {
  console.log(changed ? '这是**预演**，未写盘。加 --write 才会写入。' : '全部一致，无需同步。');
}
process.exit(0);
