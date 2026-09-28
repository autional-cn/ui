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
import { join, resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './lib/tokens.mjs';

const CONFIG = join(ROOT, 'verification', 'consumer-targets.json');

const WRITE = process.argv.includes('--write');
// 一次一站：迁移会改变站点渲染，必须逐站构建 + 跑视觉回归，所以支持 --site 限定。
const ONLY = (() => { const i = process.argv.indexOf('--site'); return i >= 0 ? process.argv[i + 1] : null; })();
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');

// 写入站点的那份 tokens.css 用**完整内联产物**而不是转发文件，
// 站点只 link 了 tailwind-preset 一个包，@import '@autional-cn/tokens/…' 在那里解析不到。
const SOURCES = [
  { from: 'packages/tokens/tokens.css', to: 'packages/tailwind-preset/tokens.css' },
  { from: 'packages/tailwind-preset/index.js', to: 'packages/tailwind-preset/index.js' },
  { from: 'packages/tailwind-preset/index.d.ts', to: 'packages/tailwind-preset/index.d.ts' },
];
// 字体与 tokens.css 同级分发：tokens.css 里的 @font-face 用相对路径 ./fonts/…，
// 消费方的打包器会把它复制进产物。缺了这些文件，Inter 就只是「声明」而非「交付」（KI-007）。
// 组件层（KI-010）：DESIGN.md 把 primitives.css 声明为共享组件层，但 14 个站点里 0 个 import 它，
// 而是各自在 global.css 里用 @apply 重写 .brand-* 与 .docs-prose。把它一并下发，站点才有东西可 import。
const COMPONENT_SOURCES = [
  { from: 'packages/tokens/primitives.css', to: 'packages/tailwind-preset/primitives.css' },
];
const FONT_SOURCES = [
  { from: 'packages/tokens/fonts/inter-latin-wght-normal.woff2', to: 'packages/tailwind-preset/fonts/inter-latin-wght-normal.woff2' },
  { from: 'packages/tokens/fonts/LICENSE-Inter-OFL.txt', to: 'packages/tailwind-preset/fonts/LICENSE-Inter-OFL.txt' },
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

if (!existsSync(SITES)) {
  console.log('sync-consumers：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}

const targets = [];
// bootstrap 列表：仓库里没有 packages/tailwind-preset 的站点（5 个 Astro 站点），
// 它们此前完全不消费设计系统。为它们建立交付路径。
const BOOTSTRAP = new Map(((JSON.parse(readFileSync(CONFIG, 'utf8')).bootstrap) || []).map((b) => [b.site, b]));
for (const site of readdirSync(SITES)) {
  const sitePath = join(SITES, site);
  if (!statSync(sitePath).isDirectory()) continue;
  const has = existsSync(join(sitePath, 'packages', 'tailwind-preset'));
  if (!has && !BOOTSTRAP.has(site)) continue;
  if (ONLY && site !== ONLY) continue;
  targets.push({ site, sitePath, bootstrap: !has, profile: BOOTSTRAP.get(site) ? BOOTSTRAP.get(site).profile : null });
}

let changed = 0;
let same = 0;
const rows = [];
const missing = [];
for (const { site, sitePath, profile } of targets) {
  const sources = SOURCES.concat(COMPONENT_SOURCES, FONT_SOURCES);
  if (profile) sources.push({ from: 'packages/tokens/profiles/' + profile + '.css', to: 'packages/tailwind-preset/profile.css' });
  for (const { from, to } of sources) {
    const src = join(ROOT, from);
    const dst = join(sitePath, to);
    // 缺源必须失败，不能静默跳过——实测踩过：web 映射到 marketing profile，
    // 但 marketing 的覆盖数为 0、生成器根本不产出该文件，于是同步静默少写一个文件，
    // 而站点的 global.css 已经 import 了它，构建期才以 ENOENT 炸出来。
    if (!existsSync(src)) { missing.push(from + '  (站点 ' + site + ' 需要)'); continue; }
    const a = readFileSync(src);
    const b = existsSync(dst) ? readFileSync(dst) : null;
    if (b && sha(a) === sha(b)) { same++; continue; }
    changed++;
    const before = b ? b.length + 'B/' + sha(b) : '(不存在)';
    rows.push('  ' + site.padEnd(15) + to.replace('packages/tailwind-preset/', '') .padEnd(13) +
      before.padEnd(22) + ' -> ' + a.length + 'B/' + sha(a));
    if (WRITE) {
      // 必须按目标文件的**父目录**建目录：字体在 fonts/ 子目录里，
      // 只 mkdir 到 tailwind-preset 会让字体写入抛 ENOENT，
      // 而错误被调用方吞掉后表现为「@font-face 在、woff2 404」——实测踩过。
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, a);
    }
  }
}

console.log('站点内置副本同步：' + targets.length + ' 个站点' + (ONLY ? '（--site ' + ONLY + '）' : ''));
console.log('  逐字节一致 ' + same + ' 个 / 需要更新 ' + changed + ' 个');
if (rows.length) {
  console.log('');
  console.log('  站点'.padEnd(17) + '文件'.padEnd(15) + '当前'.padEnd(24) + '权威');
  for (const r of rows) console.log(r);
}
if (missing.length) {
  console.log('');
  console.log('  [ERROR] 权威产物缺失，无法同步：');
  for (const m of missing) console.log('    ' + m);
  console.log('  → 检查 verification/consumer-targets.json 的 profile 映射；覆盖数为 0 的 profile 不会产出文件，应写 null。');
}
console.log('');
if (WRITE) {
  console.log(changed ? '已写入 ' + changed + ' 个文件。请逐站构建并跑视觉回归后再提交。'
    : '无需改动。');
} else {
  console.log(changed ? '这是**预演**，未写盘。加 --write 才会写入。' : '全部一致，无需同步。');
}
process.exit(missing.length ? 1 : 0);
