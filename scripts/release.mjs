#!/usr/bin/env node
// release —— 一条命令发布**两个交付面**，让它们不可能因为「忘了做另一步」而漂开。
//
// 设计系统的产物有三个交付面，都由同一份 SSOT 派生：
//   ① npm 包（构建期代码）  ② CDN（运行期资产）  ③ 站点内 vendored 副本（回滚通道）
//
// 此前它们是**三个互不相干的手工动作**，而闸门只在你主动跑 verify 时才发现不一致。
// 实测过的两次：令牌改了半个多月而 CDN 是旧的（第 24 轮发现）；
// npm 与 SSOT 之间**根本没有检查**（第 41 轮补上第 16 道闸门）。
//
// 本脚本把顺序固定下来，并在每一步失败时中止：
//   1. pnpm verify            —— 全部闸门必须全绿，否则不发（不写死道数，写死了就会过期）
//   2. pnpm -r publish        —— 发布 npm（预发版必须 --tag；registry 显式钉 npmjs）
//   3. 读回注册表             —— CLI 的成功输出不等于注册表里有（见下）
//   4. align-dist-tags        —— latest 对齐到 rc（政策见计划文末「规则 2」）
//   5. pnpm build:cdn         —— 重建 CDN 产物到 ../cdn（版本目录名带内容指纹）
//   6. 提示提交 ../cdn + 跑 bump:cdn —— 不代你提交，那是对外发布动作
//
// 第 57 轮实测的两个陷阱，都在这份脚本里被挡掉（别再靠人记）：
//   ① **pnpm 要 npm_config_registry 才认得 authToken**：本机 ~/.npmrc 的默认 registry 指向镜像站，
//      而凭据绑在 npmjs 上 —— 只给 --registry 参数不够，PUT 会 404。
//   ② **不要用 npm publish**：它会把版本「暂存」（CLI 打印成功、注册表读不到，重发报
//      E409 Cannot publish over previously staged version）。pnpm 才是能落地的那条路。
//   ③ **发布必须发生在舰队在场的机器上**：release.yml 在 CI 上跑不过自己的前置门，
//      因为 CI 里没有 sites/，门户那一层闸门按定义不生效 —— 在这里发布等于跳过它们。
//
// 用法: node scripts/release.mjs [--tag rc] [--skip-verify]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/tokens.mjs';
import { REGISTRY } from './lib/dist-tags.mjs';

const argv = process.argv.slice(2);
const tagIdx = argv.indexOf('--tag');
const TAG = tagIdx >= 0 ? argv[tagIdx + 1] : 'rc';
const SKIP_VERIFY = argv.includes('--skip-verify');

export async function main() {
  const run = (cmd, args, label, env) => {
    console.log('');
    console.log('── ' + label + ' ' + '─'.repeat(Math.max(0, 52 - label.length)));
    try {
      execFileSync(cmd, args, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: { ...process.env, ...(env || {}) },
      });
    } catch (e) {
      console.error('');
      console.error('中止：' + label + ' 失败。**没有继续往下发**——宁可停在这里，也不要让两个交付面分叉。');
      process.exit(1);
    }
  };

  // ── 前置：发布必须发生在**舰队在场**的机器上（第 57 轮实测的教训，写在这里而不是文档里）──
const SITES = process.env.AUTIONAL_SITES_DIR || resolve(ROOT, '..', 'sites');
  if (!existsSync(SITES)) {
    console.error('拒绝发布：本机没有站点树（' + SITES + '）。');
    console.error('门户那一层闸门（类型检查等）只有舰队在场时才生效 —— 在这里发布等于跳过它们。');
    console.error('要么在舰队机器上跑本脚本，要么先在本机跑 node scripts/verify.mjs --except publish,cdn 再走 CI 发布。');
    process.exit(2);
  }

  // 发布前跑的是 `verify --except publish,cdn`：那两项断言「交付面已与 SSOT 同步」，
// 而在发布**之前**它们按定义必然为红 —— 让它们变绿正是本次要做的事（与 release.yml 同一口径）。
if (!SKIP_VERIFY) run('node', ['scripts/verify.mjs', '--except', 'publish,cdn'], '1/6 全部闸门（含舰队层；排除 publish/cdn）');
  else console.log('已跳过 verify（--skip-verify，仅用于明确知道后果时）');

  // 工作区里的包清单（发布与读回都用它）—— **必须先定义再用**：
  // 第一次写这段时把它放在了读回段，于是 published 那几行落在 TDZ 里（syntax check 看不出来）。
    const packages = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(ROOT, 'packages', e.name, 'package.json'))
    .filter((p) => existsSync(p))
    .map((p) => JSON.parse(readFileSync(p, 'utf8')))
    .filter((j) => j.name && j.version);

  // 只发「本地版本还没上过注册表」的包。
  // 为什么不用 `pnpm -r publish`（第 59 轮实测）：它对**已存在的版本**会报冲突退出，
  // 于是「只改了 ui 一个包」的正常发版会被 tokens/preset/shared 的旧版本号挡住。
  // 先读一遍注册表，把要发的列出来；一个都没有就明说「无需发布」，而不是发一堆空版本。
  const published = new Set();
  for (const j of packages) {
    try {
      const r = await fetch(REGISTRY + j.name.replace('/', '%2f'), { cache: 'no-store' });
      const doc = await r.json();
      if (doc.versions && doc.versions[j.version]) published.add(j.name);
    } catch (e) { /* 读不到就当作要发，后面的读回会兜 */ }
  }
  const toPublish = packages.filter((j) => !published.has(j.name));
  console.log('');
  console.log('── 2/6 发布 npm（tag=' + TAG + '） ' + '─'.repeat(20));
  console.log('  待发：' + (toPublish.length ? toPublish.map((j) => j.name + '@' + j.version).join('、') : '（无：所有本地版本都已在注册表上）'));
  if (toPublish.length) {
    // `--filter` 每个包一个 —— 写成 `--filter "a b"` 时 pnpm 把 b 当成**脚本名**，
    // 报 "None of the selected packages has a \"b\" script"（第 59 轮实测）。
    // 顺序按依赖：tokens 在 preset 之前（后者的 workspace:* 会被改写成本地版本号）。
    const args = [];
    for (const j of toPublish) args.push('--filter', j.name);
    args.push('publish', '--access', 'public', '--tag', TAG, '--registry=' + REGISTRY, '--no-git-checks');
    run('pnpm', args, '  发布 ' + toPublish.length + ' 个包：' + toPublish.map((j) => j.name).join('、'), { npm_config_registry: REGISTRY });
  }

  // ── 读回：CLI 的成功输出不等于注册表里有 ──────────────────────────────────

  const missing = [];
  console.log('');
  console.log('── 3/6 读回注册表（CLI 说成功不算数） ' + '─'.repeat(12));
  for (const j of packages) {
    let ok = false;
    // 80s 不够：第 59 轮实测 tokens 的 processing 窗口超过了它。
  // 「读不到」与「发歪了」处置完全不同，所以宁可多等 —— 12 × 15s = 3 分钟。
  for (let i = 0; i < 12 && !ok; i++) {
      try {
        const r = await fetch(REGISTRY + j.name.replace('/', '%2f'), { cache: 'no-store' });
        const doc = await r.json();
        ok = !!(doc.versions && doc.versions[j.version]);
      } catch (e) { /* 传播窗口内读不到是正常的 */ }
      if (!ok) await new Promise((res) => setTimeout(res, 15000));
    }
    console.log('  ' + (ok ? '[OK]  ' : '[MISS]') + ' ' + j.name + '@' + j.version);
    if (!ok) missing.push(j.name + '@' + j.version);
  }
  if (missing.length) {
    console.error('');
    console.error('中止：以下版本发布后读不到：' + missing.join('、'));
    console.error('先别继续，也不要重发同一个版本号 —— 用 registry 直读复核，必要时换一个版本号再发。');
    process.exit(1);
  }

  // 发布后补跑 publish 一致性 —— 它现在有真实语义了（此前按定义为红）。
// ⚠️ 必须**带重试**：刚发布的包在 npm 上有几分钟的「processing」传播窗口，
// 第 59 轮实测：紧接着跑 check-publish 会因为读到旧的 packument 而报「内容不一致」——
// 那看起来像「发歪了」，其实是还没传播完。两种情况的处置完全不同，所以这里要等它。
console.log('');
console.log('── 发布后置门：npm 与 SSOT 一致（带传播等待） ' + '─'.repeat(10));
{
  let ok = false;
  for (let i = 1; i <= 6 && !ok; i++) {
    try {
      execFileSync('node', ['scripts/check-publish.mjs'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
      ok = true;
    } catch (e) {
      console.log('  （第 ' + i + '/6 次不一致 —— 刚发布的包可能还在 processing，等 30s 再读）');
      await new Promise((res) => setTimeout(res, 30000));
    }
  }
  if (!ok) {
    console.error('');
    console.error('中止：发布后置门连续 6 次不一致。**这时才该怀疑「发歪了」**——先人工核对再决定，别重发同一个版本号。');
    process.exit(1);
  }
}

run('node', ['scripts/align-dist-tags.mjs', '--write'], '4/6 latest 对齐到 ' + TAG);
  run('pnpm', ['build:cdn'], '5/6 重建 CDN 产物');

  const CDN = join(ROOT, '..', 'cdn');
  console.log('');
  console.log('npm 与 CDN 两个交付面都已产出。还差两步（刻意不代做）：');
  console.log('');
  console.log('① 提交 CDN（推送即触发 Vercel 生产部署）：');
  console.log('  cd ' + CDN);
  console.log('  git add -A && git commit -m "chore: 发布 v<版本>" && git push');
  console.log('');
  console.log('② 把 14 个站点的 <link> 切到新版本目录：');
  console.log('  cd ' + ROOT);
  console.log('  pnpm bump:cdn --write      # 预演先看会改什么；写完自证全舰队 0 处旧引用');
  console.log('  然后逐站提交（每站一个 chore(cdn) commit，与既有 chore(deps) 批次同构）');
  console.log('');
  console.log('为什么这两步不自动化：CDN 的 push 与站点提交都是对外发布动作，');
  console.log('而站点改动会改变渲染，按本仓惯例逐站构建 + 视觉回归后再接受。');
  console.log('忘了②会被闸门抓住：build-cdn 保留旧目录（KEEP=5），但站点若钉在被裁掉的那一个上就会 404，');
  console.log('check-assets 的 cdnDelivered() 断言「站点引用的版本在 CDN 工作区里存在」直接报红。');
  console.log('上线后再跑 node scripts/check-publish.mjs --live 与 check-cdn --live 回验。');
}

// 主模块守卫：**被 import 时不许执行**。
// 第 57 轮实测的教训：我用 node -e "import('./scripts/release.mjs')" 做语法自检，
// 结果它**真的开始发布流程了**（跑到 verify 才被管道关闭杀掉）。脚本不是模块，就别装作是。
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();