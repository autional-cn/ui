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
//   1. pnpm verify           —— 16 道闸门必须全绿，否则不发
//   2. pnpm -r publish       —— 发布 npm（预发版必须 --tag）
//   3. pnpm build:cdn        —— 重建 CDN 产物到 ../cdn
//   4. 提示提交 ../cdn       —— 不代你提交，那是对外发布动作
//
// 用法: node scripts/release.mjs [--tag rc] [--skip-verify]

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/tokens.mjs';

const argv = process.argv.slice(2);
const tagIdx = argv.indexOf('--tag');
const TAG = tagIdx >= 0 ? argv[tagIdx + 1] : 'rc';
const SKIP_VERIFY = argv.includes('--skip-verify');

const run = (cmd, args, label) => {
  console.log('');
  console.log('── ' + label + ' ' + '─'.repeat(Math.max(0, 52 - label.length)));
  try {
    execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  } catch (e) {
    console.error('');
    console.error('中止：' + label + ' 失败。**没有继续往下发**——宁可停在这里，也不要让两个交付面分叉。');
    process.exit(1);
  }
};

if (!SKIP_VERIFY) run('pnpm', ['verify'], '1/3 16 道闸门');
else console.log('已跳过 verify（--skip-verify，仅用于明确知道后果时）');

// 预发版必须显式 --tag，否则 npm 直接拒绝（实测踩过）。
run('pnpm', ['-r', 'publish', '--access', 'public', '--tag', TAG], '2/3 发布 npm（tag=' + TAG + '）');
run('pnpm', ['build:cdn'], '3/3 重建 CDN 产物');

const CDN = join(ROOT, '..', 'cdn');
console.log('');
console.log('两个交付面都已产出。还差最后一步（刻意不代做）：');
console.log('  cd ' + CDN);
console.log('  git add -A && git commit -m "chore: 发布 v<版本>" && git push');
console.log('推送到 main 即触发 Vercel 生产部署，上线后再跑 node scripts/check-publish.mjs --live 与 check-cdn --live 回验。');
