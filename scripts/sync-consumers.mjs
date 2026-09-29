#!/usr/bin/env node
// sync-consumers — 把权威产物同步到站点的内置副本
// 用法:
//   node scripts/sync-consumers.mjs           # 只报告会改什么（默认，不写盘）
//   node scripts/sync-consumers.mjs --write   # 实际写入
//   node scripts/sync-consumers.mjs --write --rollback-vendor   # 回滚通道：把内置副本写回去
//
// 2026-09 P4：设计系统改由 npm 交付，14 个站点的 packages/tailwind-preset/ 已全部删除，
// 站点改为依赖已发布的 @autional-cn/tailwind-preset 与 @autional-cn/tokens。
// 因此本脚本保留两个**常开**职责——共享组件层（packages/ui/src/molecules/ErrorBoundary.tsx）
// 与图标套件（站点 public/）；内置副本降级为**回滚通道**，只在显式 --rollback-vendor 时执行。
// 目标发现也不再以「站点里有内置副本」为条件：那个条件在副本删光后会让 targets 变成 0，
// 连带把图标套件与共享组件层一起停掉（实测踩过）。

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
import { ROOT, loadTokens, resolvedIn } from './lib/tokens.mjs';

const CONFIG = join(ROOT, 'verification', 'consumer-targets.json');

const WRITE = process.argv.includes('--write');
// 回滚通道：npm 不可用时，把内置副本写回站点，让站点可以退回「自包含」形态。
// 默认关闭——设计系统的唯一交付通道是 npm。
const VENDOR = process.argv.includes('--rollback-vendor');
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
// 共享组件层（KI-013）：packages/ui 是共享组件库，却在 9 个站点各存一份、
// 29 个文件里只有 ErrorBoundary.tsx 不同，且差异只在默认文案。
// 以 ui 仓库的 shared/ui/ErrorBoundary.tsx 为权威统一下发。
// 2026-09：共享组件层已发布为 @autional-cn/ui@0.1.0-rc，这一项随之退役。
// 之前它把 ErrorBoundary.tsx 下发给**全部 14 个站点**，其中 5 个 Astro 站的源码里
// 0 处引用它（实测 grep），9 个 SPA 站则有完整的 packages/ui 副本、现在改为 npm 依赖。
// 保留一个空数组是为了让下面的调用点不必改，语义是「共享组件层不再走拷贝通道」。
const SHARED_UI_SOURCES = [];
// antd 主题桥接（KI-011）：ui 早已生成 packages/tokens/dist/antd-theme.*，但 14 个站点 0 个消费它，
// 三个控制台各自手写 colorPrimary 等值——platform/security 更是只设 algorithm、
// 渲染出 antd 出厂蓝。下发 ESM 变体（站点应用是 ESM，原来的 .js 是 CJS）。
const ANTD_SOURCES = [
  { from: 'packages/tokens/dist/antd-theme.mjs', to: 'packages/tailwind-preset/antd-theme.mjs' },
  { from: 'packages/tokens/dist/antd-theme.d.ts', to: 'packages/tailwind-preset/antd-theme.d.ts' },
  { from: 'packages/tokens/dist/antd-theme.d.mts', to: 'packages/tailwind-preset/antd-theme.d.mts' },
];
// 组件层（KI-010）：DESIGN.md 把 primitives.css 声明为共享组件层，但 14 个站点里 0 个 import 它，
// 而是各自在 global.css 里用 @apply 重写 .brand-* 与 .docs-prose。把它一并下发，站点才有东西可 import。
const COMPONENT_SOURCES = [
  { from: 'packages/tokens/primitives.css', to: 'packages/tailwind-preset/primitives.css' },
];
const FONT_SOURCES = [
  { from: 'packages/tokens/fonts/inter-latin-wght-normal.woff2', to: 'packages/tailwind-preset/fonts/inter-latin-wght-normal.woff2' },
  { from: 'packages/tokens/fonts/LICENSE-Inter-OFL.txt', to: 'packages/tailwind-preset/fonts/LICENSE-Inter-OFL.txt' },
];

// ── 图标套件（U65④）────────────────────────────────────────────────────────
// favicon / logo 在此之前**完全没有交付通道**：ui/assets/ 只被 4 个文档文件引用，
// 14 个站点的图标全靠手工放置，已经漂移。实测：14 站里只有 3 站（developer/docs/web）
// 有完整图标组；8 个 SPA 站只声明 1 个 link；user 声明 0 个；
// status 的 /favicon-32x32.png 返回的是 SPA fallback（text/html 947B）——文件根本不存在，
// 被前端路由掩盖了，肉眼看不出来。
//
// 2026-09 轮次 42：**运行期交付已改为 CDN**。14 个站点的 <head> 现在直接
// <link href="https://cdn.autional.cn/ui/v<ver>/icons/…">，站点 public/ 里的这一份
// 因此降级为**回滚通道**，默认不再写入（与 P4 对 packages/tailwind-preset 的处理同构）。
//
// 原先的理由是「favicon 是最基础的品牌资产，不该依赖一个外部源站的可用性」。
// **这条已被明确推翻**（用户定调）：纯静态 CDN 的可用性不是主要风险，**一致性才是**；
// 做「CDN 挂了回退本地」等于又造一个来源，那正是要消灭的东西。
// 网络侧的异常（含 DNS 记录）不在本项目范围内。
//
// 来源清单仍放在 consumer-targets.json 里，sync（回滚下发）与 check-icons（漂移校验）共用同一份。
const ICON_SOURCES = (JSON.parse(readFileSync(CONFIG, 'utf8')).iconSources || {}).files || [];

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

if (!existsSync(SITES)) {
  console.log('sync-consumers：本次工作区没有 sites/，跳过（CI 里同样跳过）');
  process.exit(0);
}

// 目标 = sites/ 下的**全部**站点，与「有没有内置副本」无关。
// profiles 映射只服务回滚通道：回滚时要把正确的 profile.css 写进 packages/tailwind-preset/。
const targets = [];
const PROFILES = new Map(((JSON.parse(readFileSync(CONFIG, 'utf8')).profiles) || []).map((b) => [b.site, b]));
for (const site of readdirSync(SITES)) {
  const sitePath = join(SITES, site);
  if (!statSync(sitePath).isDirectory()) continue;
  if (ONLY && site !== ONLY) continue;
  targets.push({ site, sitePath, profile: PROFILES.get(site) ? PROFILES.get(site).profile : null });
}

let changed = 0;
let same = 0;
const rows = [];
const missing = [];
for (const { site, sitePath, profile } of targets) {
  // 共享组件层常开；内置副本只在回滚通道里写回。
  const sources = SHARED_UI_SOURCES.slice();
  if (VENDOR) {
    sources.push(...SOURCES, ...COMPONENT_SOURCES, ...FONT_SOURCES, ...ANTD_SOURCES);
    if (profile) sources.push({ from: 'packages/tokens/profiles/' + profile + '.css', to: 'packages/tailwind-preset/profile.css' });
  }
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

// ── 图标套件下发 ────────────────────────────────────────────────────────────
const CT = JSON.parse(readFileSync(CONFIG, 'utf8'));
const PUBLIC_DIRS = CT.publicDirs || {};
const THEME_COLORS = CT.themeColors || {};
const TK = loadTokens();
const RES = resolvedIn(TK, {});
// {color.x.y} 形式按令牌解析成字面量；其余字符串原样使用（用于 authenticator/user 这类
// 在默认上下文里没有对应令牌的站点专有值）。
const resolveThemeColor = (site) => {
  const raw = THEME_COLORS[site] || THEME_COLORS.default || '#003153';
  const m = /^\{([^}]+)\}$/.exec(raw);
  if (!m) return raw;
  const v = RES[m[1]];
  if (!v) throw new Error('themeColors 引用了不存在的令牌：' + raw + '（站点 ' + site + '）');
  return v;
};
const iconManifest = (site) => JSON.stringify({
  name: 'Autional', short_name: 'Autional',
  icons: [
    { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
    { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' }
  ],
  theme_color: resolveThemeColor(site),
  background_color: RES['color.neutral-0'] || '#ffffff',
  display: 'standalone'
}, null, 2) + '\n';

let iconChanged = 0;
let iconSame = 0;
const iconRows = [];
// 默认不写：图标与 site.webmanifest 的运行期来源已是 CDN，本站 public/ 只是回滚通道。
// 目标发现与执行都收在 VENDOR 里，避免「回滚通道」被误当成常规交付。
for (const { site, sitePath } of (VENDOR ? targets : [])) {
  const pub = PUBLIC_DIRS[site];
  if (!pub) { missing.push('consumer-targets.json 的 publicDirs 缺少站点 ' + site); continue; }
  const pubPath = join(sitePath, pub);
  const items = ICON_SOURCES.map((s) => ({ to: s.to, buf: readFileSync(join(ROOT, s.from)) }));
  // site.webmanifest 是**生成**的而非拷贝：原始那份用相对路径是对的（本站就要相对路径），
  // 但它的 theme_color 是手填字面量。这里改成取自令牌。
  items.push({ to: 'site.webmanifest', buf: Buffer.from(iconManifest(site), 'utf8') });
  for (const { to, buf } of items) {
    const dst = join(pubPath, to);
    const b = existsSync(dst) ? readFileSync(dst) : null;
    if (b && sha(buf) === sha(b)) { iconSame++; continue; }
    iconChanged++;
    iconRows.push('  ' + site.padEnd(15) + to.padEnd(30) + (b ? b.length + 'B/' + sha(b) : '(不存在)').padEnd(22) + ' -> ' + buf.length + 'B/' + sha(buf));
    if (WRITE) { mkdirSync(dirname(dst), { recursive: true }); writeFileSync(dst, buf); }
  }
}

console.log('交付同步：' + targets.length + ' 个站点' + (ONLY ? '（--site ' + ONLY + '）' : ''));
console.log('  模式：' + (VENDOR ? '回滚通道（含内置副本 packages/tailwind-preset/ 与图标套件 public/）' : '常规（设计系统走 npm，运行期资产走 CDN；内置副本与 public/ 图标均已退役为回滚通道）'));
console.log('  共享组件层/回滚产物：逐字节一致 ' + same + ' 个 / 需要更新 ' + changed + ' 个');
if (rows.length) {
  console.log('');
  console.log('  站点'.padEnd(17) + '文件'.padEnd(15) + '当前'.padEnd(24) + '权威');
  for (const r of rows) console.log(r);
}
console.log('');
console.log(VENDOR
  ? '图标套件下发（public/，回滚通道）：逐字节一致 ' + iconSame + ' 个 / 需要更新 ' + iconChanged + ' 个'
  : '图标套件下发（public/）：已退役为回滚通道，本次未写入（需要时加 --rollback-vendor）');
if (iconRows.length) for (const r of iconRows) console.log(r);
if (missing.length) {
  console.log('');
  console.log('  [ERROR] 权威产物缺失，无法同步：');
  for (const m of missing) console.log('    ' + m);
  console.log('  → 检查 verification/consumer-targets.json 的 profile 映射；覆盖数为 0 的 profile 不会产出文件，应写 null。');
}
console.log('');
if (WRITE) {
  console.log((changed + iconChanged) ? '已写入 ' + (changed + iconChanged) + ' 个文件。请逐站构建并跑视觉回归后再提交。'
    : '无需改动。');
} else {
  console.log(changed ? '这是**预演**，未写盘。加 --write 才会写入。' : '全部一致，无需同步。');
}
process.exit(missing.length ? 1 : 0);
